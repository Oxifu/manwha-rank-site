const fs = require('fs');
const path = require('path');

const rd = (p) => fs.readFileSync(p, 'utf8').replace(/\r\n/g, '\n');
const once = (a, b) => (s) => (s.includes(a) ? s.replace(a, () => b) : null);
const re = (r, f) => (s) => (r.test(s) ? s.replace(r, f) : null);

function edit(file, marker, steps, extra) {
  if (!fs.existsSync(file) && file.startsWith('public/')) file = file.slice(7);
  if (!fs.existsSync(file)) {
    console.error('FICHIER MANQUANT : ' + file);
    process.exitCode = 1;
    return;
  }
  let s = rd(file);
  if (s.includes(marker)) {
    console.log(file + ' : deja fait');
    return;
  }
  for (const [label, fn] of steps) {
    const r = fn(s);
    if (r === null) {
      console.error('A VERIFIER (non trouve) : ' + file + ' / ' + label);
      process.exitCode = 1;
      return;
    }
    s = r;
  }
  if (extra) s = extra(s);
  fs.writeFileSync(file, s, 'utf8');
  console.log(file + ' : OK');
}

const STATUS_KEYS = [
  'reading',
  'upcoming',
  'missing',
  'abandoned_translation',
  'abandoned_creator',
  'abandoned_manual',
  'analysis_under_30',
  'to_analyze',
  'finished'
];

// ================= server.js =================
const FILTER_ROUTES = String.raw`
const PERSONAL_FILTER_STATUSES = ${JSON.stringify(STATUS_KEYS)};

function cleanPersonalFilterInput(body) {
  const name = String(body.name || '').trim();
  const statuses = Array.isArray(body.statuses)
    ? [...new Set(body.statuses.map((value) => String(value).trim()).filter((value) => PERSONAL_FILTER_STATUSES.includes(value)))]
    : [];
  const genres = String(body.genres || '').trim().slice(0, 500);
  const minChapters = body.min_chapters === '' || body.min_chapters === null || body.min_chapters === undefined
    ? null
    : Number(body.min_chapters);
  const maxChapters = body.max_chapters === '' || body.max_chapters === null || body.max_chapters === undefined
    ? null
    : Number(body.max_chapters);

  if (!/^[^\r\n]{1,60}$/.test(name)) {
    return { error: 'Le nom du filtre doit contenir entre 1 et 60 caractères.' };
  }
  if (body.statuses !== undefined && !Array.isArray(body.statuses)) {
    return { error: 'Les statuts du filtre sont invalides.' };
  }
  if (body.statuses !== undefined && statuses.length !== body.statuses.length) {
    return { error: 'Un ou plusieurs statuts du filtre sont invalides.' };
  }
  if (minChapters !== null && (!Number.isInteger(minChapters) || minChapters < 0 || minChapters > 100000)) {
    return { error: 'Nombre minimum de chapitres invalide.' };
  }
  if (maxChapters !== null && (!Number.isInteger(maxChapters) || maxChapters < 0 || maxChapters > 100000)) {
    return { error: 'Nombre maximum de chapitres invalide.' };
  }
  if (minChapters !== null && maxChapters !== null && minChapters > maxChapters) {
    return { error: 'Le minimum de chapitres ne peut pas dépasser le maximum.' };
  }
  if (!statuses.length && !genres && minChapters === null && maxChapters === null) {
    return { error: 'Ajoute au moins un critère à ton filtre.' };
  }

  return { name, statuses, genres, minChapters, maxChapters };
}

function serializePersonalFilter(row) {
  return {
    id: row.id,
    name: row.name,
    statuses: JSON.parse(row.statuses_json || '[]'),
    genres: row.genres || '',
    min_chapters: row.min_chapters === null ? null : Number(row.min_chapters),
    max_chapters: row.max_chapters === null ? null : Number(row.max_chapters),
    created_at: row.created_at,
    updated_at: row.updated_at
  };
}

app.get('/api/filters', requireLogin, async (req, res) => {
  try {
    const rows = await dbAll(
      'SELECT id, name, statuses_json, genres, min_chapters, max_chapters, created_at, updated_at FROM personal_filters WHERE user_id = ? ORDER BY name COLLATE NOCASE ASC',
      [req.session.user.id]
    );
    res.json({ filters: rows.map(serializePersonalFilter) });
  } catch (error) {
    console.error('Erreur /api/filters :', error);
    res.status(500).json({ error: 'Impossible de récupérer tes filtres.' });
  }
});

app.post('/api/filters', requireLogin, async (req, res) => {
  const input = cleanPersonalFilterInput(req.body || {});
  if (input.error) return res.status(400).json({ error: input.error });

  try {
    const count = await dbGet('SELECT COUNT(*) AS count FROM personal_filters WHERE user_id = ?', [req.session.user.id]);
    if (Number(count?.count || 0) >= 30) {
      return res.status(400).json({ error: 'Tu as atteint la limite de 30 filtres personnels.' });
    }

    const duplicate = await dbGet(
      'SELECT id FROM personal_filters WHERE user_id = ? AND LOWER(name) = LOWER(?)',
      [req.session.user.id, input.name]
    );
    if (duplicate) return res.status(409).json({ error: 'Tu as déjà un filtre avec ce nom.' });

    const result = await dbRun(
      'INSERT INTO personal_filters (user_id, name, statuses_json, genres, min_chapters, max_chapters, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, DATETIME("now"), DATETIME("now"))',
      [req.session.user.id, input.name, JSON.stringify(input.statuses), input.genres, input.minChapters, input.maxChapters]
    );
    const row = await dbGet('SELECT id, name, statuses_json, genres, min_chapters, max_chapters, created_at, updated_at FROM personal_filters WHERE id = ? AND user_id = ?', [result.lastID, req.session.user.id]);
    res.status(201).json({ message: 'Filtre personnel créé.', filter: serializePersonalFilter(row) });
  } catch (error) {
    console.error('Erreur création filtre personnel :', error);
    res.status(500).json({ error: 'Impossible de créer ce filtre.' });
  }
});

app.put('/api/filters/:id', requireLogin, async (req, res) => {
  const input = cleanPersonalFilterInput(req.body || {});
  if (input.error) return res.status(400).json({ error: input.error });

  try {
    const existing = await dbGet('SELECT id FROM personal_filters WHERE id = ? AND user_id = ?', [req.params.id, req.session.user.id]);
    if (!existing) return res.status(404).json({ error: 'Filtre personnel introuvable.' });

    const duplicate = await dbGet(
      'SELECT id FROM personal_filters WHERE user_id = ? AND LOWER(name) = LOWER(?) AND id <> ?',
      [req.session.user.id, input.name, req.params.id]
    );
    if (duplicate) return res.status(409).json({ error: 'Tu as déjà un filtre avec ce nom.' });

    await dbRun(
      'UPDATE personal_filters SET name = ?, statuses_json = ?, genres = ?, min_chapters = ?, max_chapters = ?, updated_at = DATETIME("now") WHERE id = ? AND user_id = ?',
      [input.name, JSON.stringify(input.statuses), input.genres, input.minChapters, input.maxChapters, req.params.id, req.session.user.id]
    );
    const row = await dbGet('SELECT id, name, statuses_json, genres, min_chapters, max_chapters, created_at, updated_at FROM personal_filters WHERE id = ? AND user_id = ?', [req.params.id, req.session.user.id]);
    res.json({ message: 'Filtre personnel modifié.', filter: serializePersonalFilter(row) });
  } catch (error) {
    console.error('Erreur modification filtre personnel :', error);
    res.status(500).json({ error: 'Impossible de modifier ce filtre.' });
  }
});

app.delete('/api/filters/:id', requireLogin, async (req, res) => {
  try {
    const result = await dbRun('DELETE FROM personal_filters WHERE id = ? AND user_id = ?', [req.params.id, req.session.user.id]);
    if (!result.changes) return res.status(404).json({ error: 'Filtre personnel introuvable.' });
    res.json({ message: 'Filtre personnel supprimé.' });
  } catch (error) {
    console.error('Erreur suppression filtre personnel :', error);
    res.status(500).json({ error: 'Impossible de supprimer ce filtre.' });
  }
});
`;

edit('server.js', 'PERSONAL_FILTER_STATUSES', [
  ['nettoyage des filtres à la suppression du compte', once(
    "    await dbRun('UPDATE manwhas SET created_by = NULL WHERE created_by = ?', [target.id]);\n    await dbRun('DELETE FROM users WHERE id = ?', [target.id]);",
    "    await dbRun('UPDATE manwhas SET created_by = NULL WHERE created_by = ?', [target.id]);\n    await dbRun('DELETE FROM personal_filters WHERE user_id = ?', [target.id]);\n    await dbRun('DELETE FROM users WHERE id = ?', [target.id]);"
  )],
  ['table personal_filters', once(
    "await dbRun('CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT)');",
    "await dbRun('CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT)');\n\n  await dbRun(`\n    CREATE TABLE IF NOT EXISTS personal_filters (\n      id INTEGER PRIMARY KEY AUTOINCREMENT,\n      user_id INTEGER NOT NULL,\n      name TEXT NOT NULL,\n      statuses_json TEXT NOT NULL DEFAULT '[]',\n      genres TEXT NOT NULL DEFAULT '',\n      min_chapters INTEGER,\n      max_chapters INTEGER,\n      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,\n      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,\n      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE\n    )\n  `);\n  await dbRun('CREATE INDEX IF NOT EXISTS idx_personal_filters_user_id ON personal_filters(user_id)');") ]
], (s) => s.replace("app.get('/api/health', (req, res) => {", FILTER_ROUTES + "\napp.get('/api/health', (req, res) => {"));

console.log('Patch 13 (filtres personnels) : terminé');

// ================= PATCH 14 =================
function resolveProjectFile(name) {
  if (fs.existsSync(name)) return name;
  const publicName = path.join('public', name);
  if (fs.existsSync(publicName)) return publicName;
  throw new Error('Fichier introuvable : ' + name);
}

function patchFile(name, marker, fn) {
  const file = resolveProjectFile(name);
  let s = rd(file);
  if (s.includes(marker)) { console.log(file + ' : deja fait'); return; }
  const next = fn(s);
  if (next === null || next === undefined) throw new Error('Patch introuvable : ' + name + ' / ' + marker);
  fs.writeFileSync(file, next, 'utf8');
  console.log(file + ' : OK');
}

// --- Server: favoris ---
patchFile('server.js', 'PATCH14_FAVORITES', (s) => {
  const schema = `\n  // PATCH14_FAVORITES\n  await dbRun(\`\n    CREATE TABLE IF NOT EXISTS favorites (\n      user_id INTEGER NOT NULL,\n      manhwa_id INTEGER NOT NULL,\n      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,\n      PRIMARY KEY (user_id, manhwa_id),\n      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,\n      FOREIGN KEY (manhwa_id) REFERENCES manwhas(id) ON DELETE CASCADE\n    )\n  \`);\n  await dbRun('CREATE INDEX IF NOT EXISTS idx_favorites_user_id ON favorites(user_id)');\n`;
  const marker = "  await dbRun('CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT)');";
  if (!s.includes(marker)) return null;
  s=s.replace(marker, schema+'\n'+marker);
  const deleteUser = "    await dbRun('DELETE FROM personal_filters WHERE user_id = ?', [target.id]);\n    await dbRun('DELETE FROM users WHERE id = ?', [target.id]);";
  s=s.replace(deleteUser, "    await dbRun('DELETE FROM personal_filters WHERE user_id = ?', [target.id]);\n    await dbRun('DELETE FROM favorites WHERE user_id = ?', [target.id]);\n    await dbRun('DELETE FROM users WHERE id = ?', [target.id]);");
  const markerRoute = "app.get('/api/health', (req, res) => {";
  const routes = String.raw`

app.get('/api/favorites', requireLogin, async (req, res) => {
  try {
    const rows = await dbAll('SELECT manhwa_id FROM favorites WHERE user_id = ?', [req.session.user.id]);
    res.json({ favorites: rows.map((row) => Number(row.manhwa_id)) });
  } catch (error) {
    console.error('Erreur favoris :', error);
    res.status(500).json({ error: 'Impossible de charger les favoris.' });
  }
});

app.post('/api/favorites/:manhwaId', requireLogin, async (req, res) => {
  try {
    const id = Number(req.params.manhwaId);
    if (!Number.isInteger(id) || id < 1) return res.status(400).json({ error: 'Manhwa invalide.' });
    const exists = await dbGet('SELECT id FROM manwhas WHERE id = ?', [id]);
    if (!exists) return res.status(404).json({ error: 'Manhwa introuvable.' });
    await dbRun('INSERT OR IGNORE INTO favorites (user_id, manhwa_id) VALUES (?, ?)', [req.session.user.id, id]);
    res.json({ favorite: true, manhwa_id: id });
  } catch (error) {
    console.error('Erreur ajout favori :', error);
    res.status(500).json({ error: 'Impossible d'ajouter le favori.' });
  }
});

app.delete('/api/favorites/:manhwaId', requireLogin, async (req, res) => {
  try {
    const id = Number(req.params.manhwaId);
    await dbRun('DELETE FROM favorites WHERE user_id = ? AND manhwa_id = ?', [req.session.user.id, id]);
    res.json({ favorite: false, manhwa_id: id });
  } catch (error) {
    console.error('Erreur suppression favori :', error);
    res.status(500).json({ error: 'Impossible de retirer le favori.' });
  }
});

app.get('/api/admin/shared-sources', requireAuth, async (req, res) => {
  if (!['admin', 'editor'].includes(req.session.user.role)) return res.status(403).json({ error: 'Accès refusé.' });
  try {
    const rows = await dbAll('SELECT sources FROM manwhas WHERE sources IS NOT NULL AND sources != \'\'');
    const map = new Map();
    for (const row of rows) {
      for (const line of String(row.sources || '').split('\n')) {
        const parts = line.trim().split('|').map((p) => p.trim());
        const url = parts.length > 1 ? parts.slice(1).join('|') : parts[0];
        const name = parts.length > 1 ? parts[0] : '';
        try {
          const parsed = new URL(url);
          if (!/^https?:$/.test(parsed.protocol)) continue;
          const key = parsed.href;
          if (!map.has(key)) map.set(key, { url: parsed.href, name: name || parsed.hostname.replace(/^www\./, ''), count: 0 });
          map.get(key).count += 1;
        } catch (_) {}
      }
    }
    res.json({ sources: Array.from(map.values()).sort((a,b) => a.name.localeCompare(b.name, 'fr') || a.url.localeCompare(b.url)) });
  } catch (error) {
    console.error('Erreur liens partagés :', error);
    res.status(500).json({ error: 'Impossible de charger les liens partagés.' });
  }
});

app.put('/api/admin/shared-sources', requireAuth, async (req, res) => {
  if (!['admin', 'editor'].includes(req.session.user.role)) return res.status(403).json({ error: 'Accès refusé.' });
  const oldUrl = String(req.body.old_url || '').trim();
  const newUrl = String(req.body.new_url || '').trim();
  if (!oldUrl || !newUrl) return res.status(400).json({ error: 'Ancien et nouveau lien requis.' });
  try {
    const oldParsed = new URL(oldUrl);
    const newParsed = new URL(newUrl);
    if (!/^https?:$/.test(oldParsed.protocol) || !/^https?:$/.test(newParsed.protocol)) return res.status(400).json({ error: 'Les liens doivent utiliser http ou https.' });
    const rows = await dbAll('SELECT id, sources FROM manwhas WHERE sources IS NOT NULL AND sources != \'\'');
    let changed = 0;
    for (const row of rows) {
      const lines = String(row.sources || '').split('\n');
      let touched = false;
      const updated = lines.map((line) => {
        const parts = line.trim().split('|').map((p) => p.trim());
        if (!parts.length) return line;
        const url = parts.length > 1 ? parts.slice(1).join('|') : parts[0];
        if (url !== oldParsed.href) return line;
        touched = true;
        return parts.length > 1 ? parts[0] + ' | ' + newParsed.href : newParsed.href;
      });
      if (touched) {
        await dbRun('UPDATE manwhas SET sources = ?, updated_at = DATETIME("now") WHERE id = ?', [updated.join('\n'), row.id]);
        changed += 1;
      }
    }
    res.json({ message: 'Lien partagé mis à jour.', changed });
  } catch (error) {
    res.status(400).json({ error: 'Lien invalide.' });
  }
});
`;
  if (!s.includes(markerRoute)) return null;
  return s.replace(markerRoute, routes+'\n'+markerRoute);
});

// --- Server: suppression manhwa nettoie aussi les favoris ---
patchFile('server.js', 'PATCH14_MANWHA_DELETE_FAVORITES', (s) => {
  const old = "    await dbRun('DELETE FROM manwhas WHERE id = ?', [req.params.id]);\n    res.json({ success: true, message: 'Manhwa supprimé.' });";
  const neu = "    await dbRun('DELETE FROM favorites WHERE manhwa_id = ?', [req.params.id]);\n    await dbRun('DELETE FROM manwhas WHERE id = ?', [req.params.id]);\n    res.json({ success: true, message: 'Manhwa supprimé.' });\n    // PATCH14_MANWHA_DELETE_FAVORITES";
  return s.includes(old) ? s.replace(old, neu) : null;
});

// --- HTML: panneau des liens partagés ---
patchFile('index.html', 'id="sharedSourcesPanel"', (s) => {
  const marker = '<details id="sitePanel" class="fold hidden" open>';
  if (!s.includes(marker)) return null;
  const html = `        <details id="sharedSourcesPanel" class="fold hidden" open><summary>Liens partagés</summary>\n          <p class="muted">Modifier un lien ici le met à jour partout où ce même lien est utilisé.</p>\n          <div id="sharedSourcesList"></div>\n        </details>\n`;
  return s.replace(marker, html+marker);
});

// --- App: ouverture du seul formulaire concerné + double confirmation ---
patchFile('app.js', 'PATCH14_UI_FIXES', (s) => {
  const old = "  document.querySelectorAll('#adminPanel details').forEach((d) => { d.open = true; });";
  const neu = "  const mainFold = document.querySelector('#adminPanel > details.fold-main');\n  const manhwaFold = document.querySelector('#adminPanel > details.fold-main > details.fold');\n  if (mainFold) mainFold.open = true;\n  if (manhwaFold) manhwaFold.open = true;\n  // PATCH14_UI_FIXES";
  if (!s.includes(old)) return null;
  s=s.replace(old, neu);
  const oldDelete = "      if (!confirm('Supprimer ce manwha ?')) return;\n      await deleteManhwa(id);";
  const newDelete = "      if (!confirm('Supprimer ce manwha ?')) return;\n      if (!confirm('Confirmation finale : supprimer définitivement ce manwha ?')) return;\n      await deleteManhwa(id);";
  if (!s.includes(oldDelete)) return null;
  s=s.replace(oldDelete,newDelete);
  const modalDelete = "    if (!confirm('Supprimer ce manwha ?')) return;\n    closeModal();\n    deleteManhwa(Number(deleteButton.dataset.id));";
  const modalDeleteNew = "    if (!confirm('Supprimer ce manwha ?')) return;\n    if (!confirm('Confirmation finale : supprimer définitivement ce manwha ?')) return;\n    closeModal();\n    deleteManhwa(Number(deleteButton.dataset.id));";
  if (!s.includes(modalDelete)) return null;
  s=s.replace(modalDelete,modalDeleteNew);
  return s.replace("const STATUS_META = {", "// PATCH14_UI_FIXES\nconst STATUS_META = {");
});

// --- App: favoris ---
patchFile('app.js', 'PATCH14_FAVORITES', (s) => {
  if (s.includes('PATCH14_FAVORITES')) return s;
  const stateRe = /const state = \{([\s\S]*?)\n\};/;
  if (!stateRe.test(s)) return null;
  s=s.replace(stateRe, (m, body) => {
    if (body.includes('favorites:')) return m;
    return "const state = {" + body.replace(/search:\s*''\s*$/, "search: '',\n  favorites: new Set(),\n  activeFavoriteFilter: false") + "\n};";
  });
  const fn = String.raw`
async function loadFavorites() {
  if (!state.currentUser) { state.favorites = new Set(); return; }
  try {
    const response = await fetch('/api/favorites', { cache: 'no-store' });
    const data = await response.json();
    if (response.ok) state.favorites = new Set((data.favorites || []).map(Number));
  } catch (_) {}
}

async function toggleFavorite(id) {
  if (!state.currentUser) { alert('Connecte-toi pour utiliser les favoris.'); return; }
  const isFav = state.favorites.has(id);
  const response = await fetch('/api/favorites/' + id, { method: isFav ? 'DELETE' : 'POST' });
  const data = await response.json();
  if (!response.ok) { alert(data.error || 'Impossible de modifier le favori.'); return; }
  if (isFav) state.favorites.delete(id); else state.favorites.add(id);
  renderFilterChips(); renderBoard();
}
`;
  if (!s.includes('async function loadFavorites()')) {
    const marker = 'async function loadManwhas() {';
    if (!s.includes(marker)) return null;
    s=s.replace(marker,fn+'\n'+marker);
  }
  if (!s.includes("label: '★ Favoris'")) {
    const marker="  const statuses = [{ key: 'all', label: 'Tous', color: '#9a95ad' }, ...Object.entries(STATUS_META).map(([key, value]) => ({ key, label: value.label, color: value.color }))];";
    if (!s.includes(marker)) return null;
    s=s.replace(marker,marker+"\n  if (state.currentUser) statuses.push({ key: '__favorites__', label: '★ Favoris', color: '#f59e0b' });");
  }
  const byStatus="  const byStatus = state.manwhas.filter((item) => state.activeFilter === 'all' || item.status === state.activeFilter);";
  if (s.includes(byStatus)) s=s.replace(byStatus,"  const byStatus = state.activeFavoriteFilter ? state.manwhas.filter((item) => state.favorites.has(item.id)) : state.manwhas.filter((item) => state.activeFilter === 'all' || item.status === state.activeFilter);");
  const click="      state.activeFilter = button.dataset.filter;\n      renderFilterChips();";
  if (s.includes(click)) s=s.replace(click,"      state.activeFilter = button.dataset.filter;\n      state.activeFavoriteFilter = state.activeFilter === '__favorites__';\n      if (state.activeFavoriteFilter) state.activeFilter = 'all';\n      renderFilterChips();");
  const card="    '<div class=\"cover-wrap\"><img class=\"cover\" loading=\"lazy\" decoding=\"async\" src=\"' + esc(cover) + '\" alt=\"Couverture de ' + esc(item.title) + '\" /><span class=\"dot\"></span></div>' +";
  if (s.includes(card)) s=s.replace(card,"    '<div class=\"cover-wrap\"><img class=\"cover\" loading=\"lazy\" decoding=\"async\" src=\"' + esc(cover) + '\" alt=\"Couverture de ' + esc(item.title) + '\" /><span class=\"dot\"></span><button type=\"button\" class=\"favorite-button ' + (state.favorites.has(item.id) ? 'active' : '') + '\" data-favorite=\"' + item.id + '\" aria-label=\"' + (state.favorites.has(item.id) ? 'Retirer des favoris' : 'Ajouter aux favoris') + '\">★</button></div>' +");
  const boardCard="  const card = event.target.closest('.card');\n  if (card && !event.target.closest('button, a')) openModal(Number(card.dataset.id));";
  if (s.includes(boardCard)) s=s.replace(boardCard,"  const favorite = event.target.closest('.favorite-button');\n  if (favorite) { event.stopPropagation(); toggleFavorite(Number(favorite.dataset.favorite)); return; }\n  const card = event.target.closest('.card');\n  if (card && !event.target.closest('button, a')) openModal(Number(card.dataset.id));");
  const init="checkAuth();\nloadManwhas();";
  if (s.includes(init) && !s.includes("checkAuth();\nloadManwhas();\nloadFavorites();")) s=s.replace(init,"checkAuth();\nloadManwhas();\nloadFavorites();");
  const authTail="  renderBoard();\n}\n\nloginToggle.addEventListener('click'";
  if (s.includes(authTail)) s=s.replace(authTail,"  renderBoard();\n  loadFavorites();\n}\n\nloginToggle.addEventListener('click'");
  return s.replace("const STATUS_META = {", "// PATCH14_FAVORITES\nconst STATUS_META = {");
});

// --- App: liens partagés admin/éditeur ---
patchFile('app.js', 'PATCH14_SHARED_SOURCES', (s) => {
  const uiMarker = "async function loadUsers() {";
  if (!s.includes(uiMarker)) return null;
  const fn = String.raw`
async function loadSharedSources() {
  const panel = document.getElementById('sharedSourcesPanel');
  const list = document.getElementById('sharedSourcesList');
  if (!panel || !list || !state.currentUser || !['admin','editor'].includes(state.currentUser.role)) return;
  try {
    const response = await fetch('/api/admin/shared-sources', { cache: 'no-store' });
    const data = await response.json();
    if (!response.ok) return;
    list.innerHTML = (data.sources || []).map((source) =>
      '<div class="shared-source-row"><div><strong>' + esc(source.name) + '</strong><small>' + esc(source.url) + ' · ' + source.count + ' utilisation(s)</small></div><button type="button" class="secondary-button shared-source-edit" data-url="' + esc(source.url) + '" data-name="' + esc(source.name) + '">Modifier</button></div>'
    ).join('') || '<p class="muted">Aucun lien partagé détecté.</p>';
  } catch (_) {}
}

document.getElementById('sharedSourcesList')?.addEventListener('click', async (event) => {
  const button = event.target.closest('.shared-source-edit');
  if (!button) return;
  const oldUrl = button.dataset.url;
  const newUrl = prompt('Nouveau lien pour « ' + button.dataset.name + ' » :', oldUrl);
  if (newUrl === null || newUrl.trim() === oldUrl) return;
  const response = await fetch('/api/admin/shared-sources', { method:'PUT', headers:{'Content-Type':'application/json'}, body:JSON.stringify({old_url:oldUrl,new_url:newUrl.trim()}) });
  const data = await response.json();
  alert(response.ok ? data.message + ' ' + data.changed + ' manhwa mis à jour.' : (data.error || 'Erreur.'));
  if (response.ok) { await loadManwhas(); loadSharedSources(); }
});
`;
  s=s.replace(uiMarker,uiMarker+'\n'+fn);
  const updateUI = "  document.getElementById('sitePanel').classList.toggle('hidden', !canManage);";
  const updateNew = "  document.getElementById('sitePanel').classList.toggle('hidden', !canManage);\n  document.getElementById('sharedSourcesPanel').classList.toggle('hidden', !isStaff);\n  if (isStaff) loadSharedSources();";
  if (!s.includes(updateUI)) return null;
  return s.replace(updateUI,updateNew);
});

// --- CSS ---
patchFile('styles.css', 'PATCH14_FAVORITE_CSS', (s) => s.trimEnd() + String.raw`

/* PATCH14_FAVORITE_CSS */
.favorite-button{position:absolute;top:8px;right:8px;width:34px;height:34px;border:0;border-radius:50%;background:rgba(0,0,0,.55);color:#fff;font-size:18px;cursor:pointer;z-index:3}
.favorite-button.active{background:rgba(245,158,11,.9);color:#fff}
.shared-source-row{display:flex;justify-content:space-between;align-items:center;gap:10px;border:1px solid var(--border);border-radius:10px;padding:9px;margin-top:8px}
.shared-source-row div{min-width:0;display:flex;flex-direction:column;gap:3px}.shared-source-row small{color:var(--muted);overflow-wrap:anywhere}
@media(max-width:640px){.shared-source-row{align-items:stretch;flex-direction:column}.shared-source-row button{width:100%}}
`);

if (process.exitCode) {
  console.error('Patch interrompu : vérifie les fichiers indiqués ci-dessus.');
  process.exit(process.exitCode);
}
console.log('✅ Patch 14 terminé : corrections UI + favoris + liens partagés + filtres personnels.');
