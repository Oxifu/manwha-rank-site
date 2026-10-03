const STATUS_META = {
  reading: { label: 'Lecture', color: '#7c3aed' },
  upcoming: { label: 'À venir', color: '#22c55e' },
  missing: { label: 'Introuvable', color: '#f97316' },
  abandoned_translation: { label: 'Abandon team trad', color: '#ef4444' },
  abandoned_creator: { label: 'Abandon créateur', color: '#dc2626' },
  abandoned_manual: { label: 'Abandon manuel', color: '#f59e0b' },
  analysis_under_30: { label: 'Analyse -30 chapitres', color: '#60a5fa' },
  to_analyze: { label: 'À analyser', color: '#a78bfa' },
  finished: { label: 'Terminé', color: '#10b981' }
};

const ORDER = [
  'reading',
  'upcoming',
  'finished',
  'analysis_under_30',
  'to_analyze',
  'missing',
  'abandoned_translation',
  'abandoned_creator',
  'abandoned_manual'
];

const state = {
  manwhas: [],
  currentUser: null,
  activeFilter: 'all'
};

const board = document.getElementById('manhwaBoard');
const filterChips = document.getElementById('filterChips');
const loginToggle = document.getElementById('loginToggle');
const logoutButton = document.getElementById('logoutButton');
const loginPanel = document.getElementById('loginPanel');
const adminPanel = document.getElementById('adminPanel');
const adminBadge = document.getElementById('adminBadge');
const cardTemplate = document.getElementById('cardTemplate');
const form = document.getElementById('manhwaForm');
const userForm = document.getElementById('userForm');

function formatStatus(status) {
  return STATUS_META[status]?.label || status;
}

function renderFilterChips() {
  const statuses = [{ key: 'all', label: 'Tous' }, ...Object.entries(STATUS_META).map(([key, value]) => ({ key, label: value.label }))];

  filterChips.innerHTML = statuses
    .map(
      (item) => `
        <button class="chip ${state.activeFilter === item.key ? 'active' : ''}" data-filter="${item.key}">${item.label}</button>
      `
    )
    .join('');

  document.querySelectorAll('.chip').forEach((button) => {
    button.addEventListener('click', () => {
      state.activeFilter = button.dataset.filter;
      renderFilterChips();
      renderBoard();
    });
  });
}

function getVisibleManwhas() {
  if (state.activeFilter === 'all') {
    return state.manwhas;
  }

  return state.manwhas.filter((item) => item.status === state.activeFilter);
}

function renderBoard() {
  const visible = getVisibleManwhas();

  if (!visible.length) {
    board.innerHTML = '<div class="panel"><p>Aucun manwha pour ce filtre.</p></div>';
    return;
  }

  const grouped = {};
  for (const item of visible) {
    if (!grouped[item.status]) grouped[item.status] = [];
    grouped[item.status].push(item);
  }

  const sections = ORDER.filter((status) => grouped[status]).map((status) => {
    const items = grouped[status];
    return `
      <section class="section-block">
        <div class="section-header">
          <h3>${formatStatus(status)}</h3>
          <span class="section-count">${items.length}</span>
        </div>
        <div class="cards-grid">
          ${items.map(renderCard).join('')}
        </div>
      </section>
    `;
  });

  board.innerHTML = sections.join('');

  const editButtons = document.querySelectorAll('.edit-button');
  editButtons.forEach((button) => {
    button.addEventListener('click', () => {
      const id = Number(button.dataset.id);
      fillFormForEdit(id);
    });
  });

  const deleteButtons = document.querySelectorAll('.delete-button');
  deleteButtons.forEach((button) => {
    button.addEventListener('click', async () => {
      const id = Number(button.dataset.id);
      if (!confirm('Supprimer ce manwha ?')) return;
      await deleteManhwa(id);
    });
  });
}

function renderCard(item) {
  const description = item.description || 'Aucune description pour le moment.';
  const notes = item.notes || 'Aucune note.';
  const cover = item.cover_image || 'https://images.unsplash.com/photo-1515879218367-8466d910aaa4?auto=format&fit=crop&w=900&q=80';
  const editButtons = state.currentUser ? '<div class="card-actions"><button type="button" class="secondary-button edit-button" data-id="' + item.id + '">Modifier</button><button type="button" class="danger-button delete-button" data-id="' + item.id + '">Supprimer</button></div>' : '';

  return `
    <article class="card">
      <img class="cover" src="${cover}" alt="Couverture de ${item.title}" />
      <div class="card-body">
        <div class="card-head">
          <h3 class="title">${item.title}</h3>
          <span class="status-pill" style="background:${getStatusBackground(item.status)}; color:#fff; border-color: transparent;">${formatStatus(item.status)}</span>
        </div>
        <p class="meta">${item.genre} • ${item.chapter_count} chapitres</p>
        <p class="description">${description}</p>
        <div class="notes-box">${notes}</div>
        ${editButtons}
      </div>
    </article>
  `;
}

function getStatusBackground(status) {
  const palette = {
    reading: '#7c3aed',
    upcoming: '#22c55e',
    missing: '#f97316',
    abandoned_translation: '#ef4444',
    abandoned_creator: '#dc2626',
    abandoned_manual: '#f59e0b',
    analysis_under_30: '#60a5fa',
    to_analyze: '#a78bfa',
    finished: '#10b981'
  };

  return palette[status] || '#64748b';
}

async function loadManwhas() {
  const response = await fetch('/api/manwhas');
  const data = await response.json();
  state.manwhas = data.manwhas || [];
  renderBoard();
  updateStats();
}

function updateStats() {
  document.getElementById('statLecture').textContent = state.manwhas.filter((item) => item.status === 'reading').length;
  document.getElementById('statAbandon').textContent = state.manwhas.filter((item) => ['missing', 'abandoned_translation', 'abandoned_creator', 'abandoned_manual'].includes(item.status)).length;
  document.getElementById('statAnalyse').textContent = state.manwhas.filter((item) => ['analysis_under_30', 'to_analyze'].includes(item.status)).length;
}

async function checkAuth() {
  const response = await fetch('/api/me');
  const data = await response.json();
  state.currentUser = data.user;
  updateAuthUI();
}

function updateAuthUI() {
  const isLogged = Boolean(state.currentUser);
  loginPanel.classList.toggle('hidden', isLogged);
  logoutButton.classList.toggle('hidden', !isLogged);
  adminPanel.classList.toggle('hidden', !isLogged);
  adminBadge.textContent = state.currentUser ? state.currentUser.role : 'Visiteur';
  loginToggle.textContent = isLogged ? 'Compte connecté' : 'Connexion';
  loginToggle.disabled = isLogged;
  renderBoard();
}

loginToggle.addEventListener('click', () => {
  loginPanel.classList.toggle('hidden');
  if (!loginPanel.classList.contains('hidden')) {
    document.querySelector('#loginForm input[name="username"]').focus();
  }
});

logoutButton.addEventListener('click', async () => {
  await fetch('/api/logout', { method: 'POST' });
  state.currentUser = null;
  updateAuthUI();
  loadManwhas();
});

document.getElementById('loginForm').addEventListener('submit', async (event) => {
  event.preventDefault();
  const formData = new FormData(event.currentTarget);
  const body = {
    username: formData.get('username'),
    password: formData.get('password')
  };

  const response = await fetch('/api/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });

  const data = await response.json();

  if (!response.ok) {
    alert(data.error || 'Erreur de connexion.');
    return;
  }

  state.currentUser = data.user;
  updateAuthUI();
  event.currentTarget.reset();
  loginPanel.classList.add('hidden');
  loadManwhas();
});

async function deleteManhwa(id) {
  const response = await fetch(`/api/admin/manwhas/${id}`, { method: 'DELETE' });
  const result = await response.json();

  if (!response.ok) {
    alert(result.error || 'Erreur suppression.');
    return;
  }

  alert(result.message || 'Supprimé.');
  await loadManwhas();
}

function fillFormForEdit(id) {
  const found = state.manwhas.find((item) => item.id === id);
  if (!found) return;

  document.getElementById('manhwaId').value = found.id;
  document.getElementById('titleInput').value = found.title;
  document.getElementById('genreInput').value = found.genre || 'Autre';
  document.getElementById('chapterInput').value = found.chapter_count || 0;
  document.getElementById('statusInput').value = found.status;
  document.getElementById('coverInput').value = found.cover_image || '';
  document.getElementById('descriptionInput').value = found.description || '';
  document.getElementById('notesInput').value = found.notes || '';
  document.getElementById('submitManhwaBtn').textContent = 'Modifier';
  document.getElementById('titleInput').scrollIntoView({ behavior: 'smooth', block: 'center' });
}

function resetForm() {
  document.getElementById('manhwaForm').reset();
  document.getElementById('manhwaId').value = '';
  document.getElementById('submitManhwaBtn').textContent = 'Ajouter';
  document.getElementById('chapterInput').value = 0;
}

document.getElementById('cancelEditBtn').addEventListener('click', resetForm);

form.addEventListener('submit', async (event) => {
  event.preventDefault();

  const id = document.getElementById('manhwaId').value;
  const payload = {
    title: document.getElementById('titleInput').value,
    genre: document.getElementById('genreInput').value,
    chapter_count: Number(document.getElementById('chapterInput').value || 0),
    status: document.getElementById('statusInput').value,
    cover_image: document.getElementById('coverInput').value,
    description: document.getElementById('descriptionInput').value,
    notes: document.getElementById('notesInput').value
  };

  const url = id ? `/api/admin/manwhas/${id}` : '/api/admin/manwhas';
  const method = id ? 'PUT' : 'POST';

  const response = await fetch(url, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });

  const data = await response.json();
  if (!response.ok) {
    const firstError = data.errors?.[0]?.msg || data.error || 'Erreur lors de la sauvegarde.';
    alert(firstError);
    return;
  }

  resetForm();
  await loadManwhas();
});

userForm.addEventListener('submit', async (event) => {
  event.preventDefault();

  const username = document.getElementById('newUserName').value.trim();
  const password = document.getElementById('newUserPassword').value;
  const role = document.getElementById('newUserRole').value;

  const response = await fetch('/api/admin/users', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password, role })
  });

  const data = await response.json();
  if (!response.ok) {
    alert(data.error || data.errors?.[0]?.msg || 'Impossible de créer ce compte.');
    return;
  }

  alert(`Compte ${data.user.username} créé avec succès.`);
  userForm.reset();
});

renderFilterChips();
checkAuth();
loadManwhas();
