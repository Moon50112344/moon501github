document.addEventListener('DOMContentLoaded', async () => {
  const repoGrid = document.getElementById('repo-grid');
  const emptyState = document.getElementById('empty-state');
  async function fetchRepos() {
    try {
      // Simulate slight network delay for better skeleton visibility on fast connections
      await new Promise(resolve => setTimeout(resolve, 400));
      const response = await fetch('/api/repos');
      if (!response.ok) throw new Error('API Unavailable');
      const repos = await response.json();
      renderRepos(repos);
    } catch (error) {
      console.error('Error fetching repositories:', error);
      if (repoGrid) {
        repoGrid.innerHTML = `
          <div class="col-span-full py-20 text-center bg-slate-900/50 rounded-3xl border border-slate-800">
            <div class="inline-flex p-4 bg-red-500/10 rounded-full mb-4">
              <i data-lucide="wifi-off" class="w-8 h-8 text-red-400"></i>
            </div>
            <p class="text-slate-300 font-medium mb-4">Failed to connect to the showcase service.</p>
            <button onclick="window.location.reload()" class="bg-slate-800 hover:bg-slate-700 text-white px-6 py-2 rounded-full transition-all text-sm font-semibold border border-slate-700">
              Retry Connection
            </button>
          </div>
        `;
        if (window.lucide) window.lucide.createIcons();
      }
    }
  }
  function renderRepos(repos) {
    if (!repoGrid) return;
    repoGrid.innerHTML = '';
    if (repos.length === 0) {
      emptyState.classList.remove('hidden');
      repoGrid.classList.add('hidden');
      return;
    }
    emptyState.classList.add('hidden');
    repoGrid.classList.remove('hidden');
    const fragment = document.createDocumentFragment();
    repos.forEach((repo, index) => {
      const card = document.createElement('div');
      card.className = 'repo-card bg-slate-900 border border-slate-800 rounded-2xl overflow-hidden flex flex-col group opacity-0 translate-y-6';
      card.style.transition = 'all 0.6s cubic-bezier(0.22, 1, 0.36, 1)';
      card.style.transitionDelay = `${index * 60}ms`;
      const description = repo.description && repo.description.trim() 
        ? repo.description 
        : 'A sophisticated engineering project exploring modern web standards and architectural patterns.';
      const fallbackImg = 'https://images.unsplash.com/photo-1517694712202-14dd9538aa97?auto=format&fit=crop&q=80&w=800';
      card.innerHTML = `
        <div class="aspect-video relative overflow-hidden bg-slate-800">
          <img 
            src="${repo.imageUrl}" 
            alt="${repo.name}" 
            class="w-full h-full object-cover transition-transform duration-700 group-hover:scale-110 fade-in-image"
            onload="this.classList.add('loaded')"
            onerror="this.src='${fallbackImg}'; this.classList.add('loaded')"
          />
          <div class="absolute inset-0 bg-gradient-to-t from-slate-950/90 via-slate-950/20 to-transparent"></div>
        </div>
        <div class="p-8 flex-grow flex flex-col">
          <h3 class="text-2xl font-bold text-white mb-3 tracking-tight group-hover:text-blue-400 transition-colors">${repo.name}</h3>
          <p class="text-slate-400 text-sm mb-8 flex-grow leading-relaxed line-clamp-3">
            ${description}
          </p>
          <a href="${repo.repoUrl}" target="_blank" rel="noopener noreferrer" 
             class="inline-flex items-center justify-center gap-2 bg-blue-600 hover:bg-blue-500 text-white font-bold py-3 px-6 rounded-xl transition-all shadow-lg shadow-blue-900/20">
            View Repository
            <i data-lucide="external-link" class="w-4 h-4"></i>
          </a>
        </div>
      `;
      fragment.appendChild(card);
      requestAnimationFrame(() => {
        setTimeout(() => {
          card.classList.remove('opacity-0', 'translate-y-6');
        }, 50);
      });
    });
    repoGrid.appendChild(fragment);
    if (window.lucide) {
      window.lucide.createIcons();
      setTimeout(() => window.lucide.createIcons(), 600);
    }
  }
  fetchRepos();
});