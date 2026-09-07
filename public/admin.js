document.addEventListener('DOMContentLoaded', () => {
  const addForm = document.getElementById('add-repo-form');
  const adminList = document.getElementById('admin-repo-list');
  const adminEmptyState = document.getElementById('admin-empty-state');
  const submitBtn = document.getElementById('submit-btn');
  const logoutBtn = document.getElementById('logout-btn');

  // ĐÃ SỬA: Xóa dấu gạch chéo ở cuối link để tránh lỗi URL ghép chuỗi
  const WORKER_URL = 'https://moon501github.moon10512344.workers.dev';

  const checkAuthCookie = () => {
    const value = `; ${document.cookie}`;
    const parts = value.split(`; is_authed=`);
    if (parts.length === 2) return parts.pop().split(';').shift() === 'true';
    return false;
  };

  const getAuthToken = () => localStorage.getItem('auth_token');

  function handleLogout() {
    document.cookie = "is_authed=; expires=Thu, 01 Jan 1970 00:00:00 UTC; path=/;";
    localStorage.removeItem('auth_token');
    localStorage.removeItem('is_admin');
    window.location.href = '/login';
  }

  if (logoutBtn) logoutBtn.addEventListener('click', handleLogout);

  async function fetchAndRenderAdminList() {
    const token = getAuthToken();
    const hasCookie = checkAuthCookie();

    if (!token || !hasCookie) return handleLogout();

    try {
      const response = await fetch(`${WORKER_URL}/api/repos`, {
        method: 'GET',
        headers: { 
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        }
      });
      
      if (response.status === 401) return handleLogout();
      if (!response.ok) throw new Error("API Connection Failed");
      
      const repos = await response.json();
      renderAdminList(repos);
    } catch (error) {
      console.error('Error fetching admin list:', error);
      if (adminList) adminList.innerHTML = '<p class="text-red-400 p-4 bg-red-400/10 rounded-xl border border-red-400/20">Critical: Failed to synchronize with server.</p>';
    }
  }

  function renderAdminList(repos) {
    if (!adminList) return;
    adminList.innerHTML = '';
    
    if (repos.length === 0) {
      adminEmptyState?.classList.remove('hidden');
      adminList.classList.add('hidden');
      return;
    }
    
    adminEmptyState?.classList.add('hidden');
    adminList.classList.remove('hidden');
    
    repos.forEach(repo => {
      const item = document.createElement('div');
      item.className = 'admin-card-container flex items-center justify-between p-4 rounded-2xl group transition-all animate-in fade-in slide-in-from-right-2 duration-300';
      item.innerHTML = `
        <div class="flex items-center gap-4 overflow-hidden">
          <div class="w-14 h-14 rounded-xl bg-slate-800 overflow-hidden flex-shrink-0 border border-slate-700/50">
            <img src="${repo.imageUrl}" class="w-full h-full object-cover group-hover:scale-110 transition-transform duration-500" onerror="this.src='https://placehold.co'">
          </div>
          <div class="min-w-0">
            <h4 class="font-bold text-white truncate text-base mb-0.5">${repo.name}</h4>
            <p class="text-xs text-slate-500 truncate max-w-[200px] md:max-w-md font-mono">${repo.repoUrl}</p>
          </div>
        </div>
        <button class="delete-btn p-3 text-slate-500 hover:text-red-400 hover:bg-red-400/10 rounded-xl transition-all lg:opacity-0 lg:group-hover:opacity-100" data-id="${repo.id}" aria-label="Remove Project">
          <i data-lucide="trash-2" class="w-5 h-5 pointer-events-none"></i>
        </button>
      `;
      adminList.appendChild(item);
    });
    if (window.lucide) window.lucide.createIcons();
  }

  if (addForm) {
    addForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      e.stopPropagation();

      const formData = new FormData(addForm);
      const data = Object.fromEntries(formData.entries());
      
      if (!data.description) data.description = "A sophisticated engineering project exploring modern web standards.";
      if (!data.imageUrl || data.imageUrl.trim() === "") data.imageUrl = "https://unsplash.com";

      const token = getAuthToken();
      const hasCookie = checkAuthCookie();
      if (!token || !hasCookie) return handleLogout();

      submitBtn.disabled = true;
      const originalHtml = submitBtn.innerHTML;
      submitBtn.innerHTML = '<i data-lucide="loader-2" class="w-5 h-5 animate-spin"></i> Processing...';
      if (window.lucide) window.lucide.createIcons();

      try {
        const response = await fetch(`${WORKER_URL}/api/repos`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
          body: JSON.stringify(data)
        });

        if (response.ok || response.status === 201) {
          addForm.reset();
          await fetchAndRenderAdminList();
          
          submitBtn.classList.replace('bg-blue-600', 'bg-green-600');
          submitBtn.innerHTML = '<i data-lucide="check" class="w-5 h-5"></i> Success';
          if (window.lucide) window.lucide.createIcons();
          
          setTimeout(() => {
            submitBtn.classList.replace('bg-green-600', 'bg-blue-600');
            submitBtn.innerHTML = originalHtml;
            if (window.lucide) window.lucide.createIcons();
          }, 1500);
        } else if (response.status === 401) {
          handleLogout();
        } else {
          alert('Error from Server. Status: ' + response.status);
        }
      } catch (err) {
        console.error(err);
        submitBtn.innerHTML = originalHtml;
        if (window.lucide) window.lucide.createIcons();
      } finally {
        submitBtn.disabled = false;
      }
    });
  }

  adminList?.addEventListener('click', async (e) => {
    const btn = e.target.closest('.delete-btn');
    if (!btn) return;
    const id = btn.getAttribute('data-id');
    const token = getAuthToken();
    const hasCookie = checkAuthCookie();
    
    if (!token || !hasCookie) return handleLogout();

    const confirmed = confirm('CRITICAL: This project will be PERMANENTLY removed. Are you sure?');
    if (!confirmed) return;

    btn.disabled = true;
    const originalBtnInner = btn.innerHTML;
    btn.innerHTML = '<i data-lucide="loader-2" class="w-4 h-4 animate-spin text-red-400"></i>';
    if (window.lucide) window.lucide.createIcons();

    try {
      const response = await fetch(`${WORKER_URL}/api/repos/${id}`, {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${token}` }
      });

      if (response.ok) {
        btn.closest('.admin-card-container').classList.add('opacity-0', 'scale-95');
        setTimeout(() => fetchAndRenderAdminList(), 300);
      } else if (response.status === 401) {
        handleLogout();
      } else {
        throw new Error('Deletion failed');
      }
    } catch (err) {
      console.error(err);
      btn.disabled = false;
      btn.innerHTML = originalBtnInner;
      if (window.lucide) window.lucide.createIcons();
      alert('Unable to delete project.');
    }
  });

  fetchAndRenderAdminList();
});
