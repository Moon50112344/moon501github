document.addEventListener('DOMContentLoaded', () => {
  const loginForm = document.getElementById('login-form');
  const passwordInput = document.getElementById('password');
  const errorMessage = document.getElementById('error-message');
  const loginBtn = document.getElementById('login-btn');
  const togglePasswordBtn = document.getElementById('toggle-password');
  
  // ĐÃ ĐỒNG BỘ: Link API Worker tuyệt đối
  const WORKER_URL = 'https://moon501github.moon10512344.workers.dev';

  if (togglePasswordBtn && passwordInput) {
    togglePasswordBtn.addEventListener('click', () => {
      const type = passwordInput.getAttribute('type') === 'password' ? 'text' : 'password';
      passwordInput.setAttribute('type', type);
      const icon = togglePasswordBtn.querySelector('i');
      if (icon && window.lucide) {
        icon.setAttribute('data-lucide', type === 'password' ? 'eye' : 'eye-off');
        window.lucide.createIcons();
      }
    });
  }

  if (loginForm) {
    loginForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (!passwordInput || !loginBtn) return;

      const password = passwordInput.value;
      errorMessage?.classList.add('hidden');

      loginBtn.disabled = true;
      const originalHtml = loginBtn.innerHTML;
      loginBtn.innerHTML = '<i data-lucide="loader-2" class="w-5 h-5 animate-spin"></i> Verifying...';
      if (window.lucide) window.lucide.createIcons();

      try {
        const response = await fetch(`${WORKER_URL}/api/login`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ password })
        });

        if (response.ok) {
          const result = await response.json();
          if (result.token) localStorage.setItem('auth_token', result.token);
          if (result.success) localStorage.setItem('is_admin', 'true');
          
          window.location.href = '/admin';
        } else {
          if (errorMessage) {
            errorMessage.classList.remove('hidden');
            errorMessage.classList.add('animate-shake');
            setTimeout(() => errorMessage.classList.remove('animate-shake'), 400);
          }
          loginBtn.disabled = false;
          loginBtn.innerHTML = originalHtml;
          if (window.lucide) window.lucide.createIcons();
        }
      } catch (err) {
        console.error('Login error:', err);
        loginBtn.disabled = false;
        loginBtn.innerHTML = originalHtml;
        if (window.lucide) window.lucide.createIcons();
      }
    });
  }
});
