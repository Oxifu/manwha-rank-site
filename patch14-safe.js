const fs = require('fs');
const path = require('path');

// ============================================
// PATCH 14 SAFE - Version vérifiée et sécurisée
// ============================================
// Utilisation : node patch14-safe.js
// ============================================

const VERSION = '1.0.0';
let successCount = 0;
let skipCount = 0;
let errorCount = 0;

// Utilitaires de lecture/écriture sécurisée
const readFile = (filePath) => {
  try {
    return fs.readFileSync(filePath, 'utf8').replace(/\r\n/g, '\n');
  } catch (e) {
    return null;
  }
};

const writeFile = (filePath, content) => {
  try {
    fs.writeFileSync(filePath, content, 'utf8');
    return true;
  } catch (e) {
    console.error(`❌ Impossible d'écrire dans ${filePath}: ${e.message}`);
    return false;
  }
};

const backupFile = (filePath) => {
  const backupPath = `${filePath}.backup.${Date.now()}`;
  try {
    const content = readFile(filePath);
    if (!content) return null;
    fs.writeFileSync(backupPath, content, 'utf8');
    console.log(`   📦 Sauvegarde : ${backupPath}`);
    return backupPath;
  } catch (e) {
    console.error(`   ⚠️  Impossible de sauvegarder : ${e.message}`);
    return null;
  }
};

const findFile = (name) => {
  if (fs.existsSync(name)) return name;
  if (fs.existsSync(path.join('public', name))) return path.join('public', name);
  return null;
};

const patchMarker = (content, marker) => {
  return content.includes(marker);
};

// Patch sécurisé avec vérification avant/après
const safePatch = (fileName, marker, description, replaceFn) => {
  const file = findFile(fileName);
  if (!file) {
    console.log(`⏭️  ${fileName} : fichier introuvable, passé`);
    skipCount++;
    return false;
  }

  let content = readFile(file);
  if (!content) {
    console.log(`⏭️  ${fileName} : impossible de lire, passé`);
    skipCount++;
    return false;
  }

  if (patchMarker(content, marker)) {
    console.log(`✓ ${fileName} : déjà patché`);
    skipCount++;
    return true;
  }

  backupFile(file);

  const newContent = replaceFn(content);
  if (newContent === null || newContent === undefined || newContent === content) {
    console.log(`❌ ${fileName} : patch échoué (${description})`);
    errorCount++;
    return false;
  }

  if (!writeFile(file, newContent)) {
    errorCount++;
    return false;
  }

  console.log(`✅ ${fileName} : ${description}`);
  successCount++;
  return true;
};

// ============================================
// PATCH 13 - Filtres personnels
// ============================================
console.log('\n📌 PATCH 13 : Filtres personnels privés');
console.log('━'.repeat(50));

safePatch('server.js', 'PERSONAL_FILTER_STATUSES', 'Routes filtres personnels', (s) => {
  const marker = "app.get('/api/health', (req, res) => {";
  if (!s.includes(marker)) return null;

  const routes = `
const PERSONAL_FILTER_STATUSES = ['reading', 'upcoming', 'missing', 'abandoned_translation', 'abandoned_creator', 'abandoned_manual', 'analysis_under_30', 'to_analyze', 'finished'];

function cleanPersonalFilterInput(body) {
  const name = String(body.name || '').trim();
  const statuses = Array.isArray(body.statuses)
    ? [...new Set(body.statuses.map((v) => String(v).trim()).filter((v) => PERSONAL_FILTER_STATUSES.includes(v)))]
    : [];
  const genres = String(body.genres || '').trim().slice(0, 500);
  const minChapters = body.min_chapters === '' || body.min_chapters === null ? null : Number(body.min_chapters);
  const maxChapters = body.max_chapters === '' || body.max_chapters === null ? null : Number(body.max_chapters);

  if (!/^[^\\r\\n]{1,60}$/.test(name)) return { error: 'Le nom du filtre doit contenir entre 1 et 60 caractères.' };
  if (body.statuses && statuses.length !== body.statuses.length) return { error: 'Un ou plusieurs statuts sont invalides.' };
  if (minChapters !== null && (!Number.isInteger(minChapters) || minChapters < 0)) return { error: 'Minimum de chapitres invalide.' };
  if (maxChapters !== null && (!Number.isInteger(maxChapters) || maxChapters < 0)) return { error: 'Maximum de chapitres invalide.' };
  if (minChapters !== null && maxChapters !== null && minChapters > maxChapters) return { error: 'Le minimum ne peut pas dépasser le maximum.' };

  return { name, statuses, genres, minChapters, maxChapters };
}

app.get('/api/filters', requireLogin, async (req, res) => {
  try {
    const rows = await dbAll('SELECT id, name, statuses_json, genres, min_chapters, max_chapters FROM personal_filters WHERE user_id = ? ORDER BY name COLLATE NOCASE', [req.session.user.id]);
    const filters = rows.map((r) => ({ id: r.id, name: r.name, statuses: JSON.parse(r.statuses_json || '[]'), genres: r.genres || '', min_chapters: r.min_chapters, max_chapters: r.max_chapters }));
    res.json({ filters });
  } catch (e) {
    console.error('Erreur /api/filters :', e);
    res.status(500).json({ error: 'Impossible de récupérer tes filtres.' });
  }
});

app.post('/api/filters', requireLogin, async (req, res) => {
  const input = cleanPersonalFilterInput(req.body || {});
  if (input.error) return res.status(400).json({ error: input.error });

  try {
    const count = await dbGet('SELECT COUNT(*) as cnt FROM personal_filters WHERE user_id = ?', [req.session.user.id]);
    if ((count?.cnt || 0) >= 30) return res.status(400).json({ error: 'Limite de 30 filtres atteinte.' });

    const dup = await dbGet('SELECT id FROM personal_filters WHERE user_id = ? AND LOWER(name) = LOWER(?)', [req.session.user.id, input.name]);
    if (dup) return res.status(409).json({ error: 'Tu as déjà un filtre avec ce nom.' });

    const r = await dbRun('INSERT INTO personal_filters (user_id, name, statuses_json, genres, min_chapters, max_chapters, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, DATETIME("now"), DATETIME("now"))', [req.session.user.id, input.name, JSON.stringify(input.statuses), input.genres, input.minChapters, input.maxChapters]);
    const row = await dbGet('SELECT id, name, statuses_json, genres, min_chapters, max_chapters FROM personal_filters WHERE id = ?', [r.lastID]);
    const filter = { id: row.id, name: row.name, statuses: JSON.parse(row.statuses_json || '[]'), genres: row.genres || '', min_chapters: row.min_chapters, max_chapters: row.max_chapters };
    res.status(201).json({ message: 'Filtre créé.', filter });
  } catch (e) {
    console.error('Erreur création filtre :', e);
    res.status(500).json({ error: 'Impossible de créer le filtre.' });
  }
});

app.put('/api/filters/:id', requireLogin, async (req, res) => {
  const input = cleanPersonalFilterInput(req.body || {});
  if (input.error) return res.status(400).json({ error: input.error });

  try {
    const existing = await dbGet('SELECT id FROM personal_filters WHERE id = ? AND user_id = ?', [req.params.id, req.session.user.id]);
    if (!existing) return res.status(404).json({ error: 'Filtre introuvable.' });

    const dup = await dbGet('SELECT id FROM personal_filters WHERE user_id = ? AND LOWER(name) = LOWER(?) AND id <> ?', [req.session.user.id, input.name, req.params.id]);
    if (dup) return res.status(409).json({ error: 'Tu as déjà un filtre avec ce nom.' });

    await dbRun('UPDATE personal_filters SET name = ?, statuses_json = ?, genres = ?, min_chapters = ?, max_chapters = ?, updated_at = DATETIME("now") WHERE id = ? AND user_id = ?', [input.name, JSON.stringify(input.statuses), input.genres, input.minChapters, input.maxChapters, req.params.id, req.session.user.id]);
    const row = await dbGet('SELECT id, name, statuses_json, genres, min_chapters, max_chapters FROM personal_filters WHERE id = ?', [req.params.id]);
    const filter = { id: row.id, name: row.name, statuses: JSON.parse(row.statuses_json || '[]'), genres: row.genres || '', min_chapters: row.min_chapters, max_chapters: row.max_chapters };
    res.json({ message: 'Filtre modifié.', filter });
  } catch (e) {
    console.error('Erreur modification filtre :', e);
    res.status(500).json({ error: 'Impossible de modifier le filtre.' });
  }
});

app.delete('/api/filters/:id', requireLogin, async (req, res) => {
  try {
    const r = await dbRun('DELETE FROM personal_filters WHERE id = ? AND user_id = ?', [req.params.id, req.session.user.id]);
    if (!r.changes) return res.status(404).json({ error: 'Filtre introuvable.' });
    res.json({ message: 'Filtre supprimé.' });
  } catch (e) {
    console.error('Erreur suppression filtre :', e);
    res.status(500).json({ error: 'Impossible de supprimer le filtre.' });
  }
});
`;

  return s.replace(marker, routes + '\n' + marker);
});

safePatch('server.js', 'PATCH13_TABLE_PERSONAL_FILTERS', 'Table personal_filters', (s) => {
  const marker = "await dbRun('CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT)');";
  if (!s.includes(marker)) return null;

  const table = `
  // PATCH13_TABLE_PERSONAL_FILTERS
  await dbRun(\`
    CREATE TABLE IF NOT EXISTS personal_filters (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      name TEXT NOT NULL,
      statuses_json TEXT NOT NULL DEFAULT '[]',
      genres TEXT NOT NULL DEFAULT '',
      min_chapters INTEGER,
      max_chapters INTEGER,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    )
  \`);
  await dbRun('CREATE INDEX IF NOT EXISTS idx_pf_user ON personal_filters(user_id)');
`;

  return s.replace(marker, table + '\n  ' + marker);
});

safePatch('server.js', 'PATCH13_DELETE_FILTERS', 'Nettoyage filtres à suppression compte', (s) => {
  const old = "    await dbRun('UPDATE manwhas SET created_by = NULL WHERE created_by = ?', [target.id]);\n    await dbRun('DELETE FROM users WHERE id = ?', [target.id]);";
  if (!s.includes(old)) return null;

  return s.replace(old, "    await dbRun('UPDATE manwhas SET created_by = NULL WHERE created_by = ?', [target.id]);\n    await dbRun('DELETE FROM personal_filters WHERE user_id = ?', [target.id]);\n    // PATCH13_DELETE_FILTERS\n    await dbRun('DELETE FROM users WHERE id = ?', [target.id]);");
});

// ============================================
// PATCH 14 - Favoris
// ============================================
console.log('\n📌 PATCH 14 : Système de favoris');
console.log('━'.repeat(50));

safePatch('server.js', 'PATCH14_TABLE_FAVORITES', 'Table favorites', (s) => {
  const marker = "await dbRun('CREATE INDEX IF NOT EXISTS idx_pf_user ON personal_filters(user_id)');";
  if (!s.includes(marker)) return null;

  const table = `
  // PATCH14_TABLE_FAVORITES
  await dbRun(\`
    CREATE TABLE IF NOT EXISTS favorites (
      user_id INTEGER NOT NULL,
      manhwa_id INTEGER NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (user_id, manhwa_id),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (manhwa_id) REFERENCES manwhas(id) ON DELETE CASCADE
    )
  \`);
  await dbRun('CREATE INDEX IF NOT EXISTS idx_fav_user ON favorites(user_id)');
`;

  return s.replace(marker, marker + '\n' + table);
});

safePatch('server.js', 'PATCH14_FAVORITES_ROUTES', 'Routes favoris API', (s) => {
  const marker = "app.get('/api/health', (req, res) => {";
  if (!s.includes(marker)) return null;

  const routes = `
app.get('/api/favorites', requireLogin, async (req, res) => {
  try {
    const rows = await dbAll('SELECT manhwa_id FROM favorites WHERE user_id = ?', [req.session.user.id]);
    res.json({ favorites: rows.map((r) => Number(r.manhwa_id)) });
  } catch (e) {
    console.error('Erreur favoris :', e);
    res.status(500).json({ error: 'Impossible de charger les favoris.' });
  }
});

app.post('/api/favorites/:id', requireLogin, async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id < 1) return res.status(400).json({ error: 'Manhwa invalide.' });
    const m = await dbGet('SELECT id FROM manwhas WHERE id = ?', [id]);
    if (!m) return res.status(404).json({ error: 'Manhwa introuvable.' });
    await dbRun('INSERT OR IGNORE INTO favorites (user_id, manhwa_id) VALUES (?, ?)', [req.session.user.id, id]);
    res.json({ favorite: true, manhwa_id: id });
  } catch (e) {
    console.error('Erreur ajout favori :', e);
    res.status(500).json({ error: 'Impossible d'ajouter le favori.' });
  }
});

app.delete('/api/favorites/:id', requireLogin, async (req, res) => {
  try {
    const id = Number(req.params.id);
    await dbRun('DELETE FROM favorites WHERE user_id = ? AND manhwa_id = ?', [req.session.user.id, id]);
    res.json({ favorite: false, manhwa_id: id });
  } catch (e) {
    console.error('Erreur suppression favori :', e);
    res.status(500).json({ error: 'Impossible de retirer le favori.' });
  }
});
`;

  return s.replace(marker, routes + '\n' + marker);
});

safePatch('server.js', 'PATCH14_DELETE_FAVORITES', 'Nettoyage favoris à suppression compte', (s) => {
  const old = "    await dbRun('DELETE FROM personal_filters WHERE user_id = ?', [target.id]);\n    // PATCH13_DELETE_FILTERS\n    await dbRun('DELETE FROM users WHERE id = ?', [target.id]);";
  if (!s.includes(old)) return null;

  return s.replace(old, "    await dbRun('DELETE FROM personal_filters WHERE user_id = ?', [target.id]);\n    await dbRun('DELETE FROM favorites WHERE user_id = ?', [target.id]);\n    // PATCH14_DELETE_FAVORITES\n    // PATCH13_DELETE_FILTERS\n    await dbRun('DELETE FROM users WHERE id = ?', [target.id]);");
});

safePatch('server.js', 'PATCH14_MANWHA_DELETE', 'Nettoyage favoris à suppression manhwa', (s) => {
  const old = "    await dbRun('DELETE FROM manwhas WHERE id = ?', [req.params.id]);\n    res.json({ success: true, message: 'Manhwa supprimé.' });";
  if (!s.includes(old)) return null;

  return s.replace(old, "    await dbRun('DELETE FROM favorites WHERE manhwa_id = ?', [req.params.id]);\n    await dbRun('DELETE FROM manwhas WHERE id = ?', [req.params.id]);\n    res.json({ success: true, message: 'Manhwa supprimé.' });\n    // PATCH14_MANWHA_DELETE");
});

// ============================================
// PATCH 14B - Liens partagés (admin/éditeur)
// ============================================
console.log('\n📌 PATCH 14B : Liens partagés');
console.log('━'.repeat(50));

safePatch('server.js', 'PATCH14B_SHARED_SOURCES', 'Routes liens partagés', (s) => {
  const marker = "app.get('/api/favorites', requireLogin, async (req, res) => {";
  if (!s.includes(marker)) return null;

  const routes = `
app.get('/api/admin/shared-sources', requireAuth, async (req, res) => {
  if (!['admin', 'editor'].includes(req.session.user.role)) return res.status(403).json({ error: 'Accès refusé.' });
  try {
    const rows = await dbAll('SELECT sources FROM manwhas WHERE sources IS NOT NULL AND sources != \'\'');
    const map = new Map();
    for (const row of rows) {
      if (!row.sources) continue;
      for (const line of String(row.sources).split('\\n')) {
        const parts = line.trim().split('|').map((p) => p.trim());
        if (!parts.length) continue;
        const url = parts.length > 1 ? parts.slice(1).join('|') : parts[0];
        const name = parts.length > 1 ? parts[0] : '';
        try {
          const u = new URL(url);
          if (!/^https?:$/.test(u.protocol)) continue;
          const key = u.href;
          if (!map.has(key)) map.set(key, { url: u.href, name: name || u.hostname.replace(/^www\\./, ''), count: 0 });
          map.get(key).count += 1;
        } catch (_) {}
      }
    }
    const sources = Array.from(map.values()).sort((a, b) => a.name.localeCompare(b.name, 'fr') || a.url.localeCompare(b.url));
    res.json({ sources });
  } catch (e) {
    console.error('Erreur liens partagés :', e);
    res.status(500).json({ error: 'Impossible de charger les liens.' });
  }
});

app.put('/api/admin/shared-sources', requireAuth, async (req, res) => {
  if (!['admin', 'editor'].includes(req.session.user.role)) return res.status(403).json({ error: 'Accès refusé.' });
  const oldUrl = String(req.body.old_url || '').trim();
  const newUrl = String(req.body.new_url || '').trim();
  if (!oldUrl || !newUrl) return res.status(400).json({ error: 'Ancien et nouveau lien requis.' });

  try {
    const op = new URL(oldUrl);
    const np = new URL(newUrl);
    if (!/^https?:$/.test(op.protocol) || !/^https?:$/.test(np.protocol)) return res.status(400).json({ error: 'Utilise http ou https.' });

    const rows = await dbAll('SELECT id, sources FROM manwhas WHERE sources IS NOT NULL AND sources != \'\'');
    let changed = 0;

    for (const row of rows) {
      const lines = String(row.sources || '').split('\\n');
      let touched = false;
      const updated = lines.map((line) => {
        const parts = line.trim().split('|').map((p) => p.trim());
        if (!parts.length) return line;
        const url = parts.length > 1 ? parts.slice(1).join('|') : parts[0];
        if (url !== op.href) return line;
        touched = true;
        return parts.length > 1 ? parts[0] + ' | ' + np.href : np.href;
      });
      if (touched) {
        await dbRun('UPDATE manwhas SET sources = ?, updated_at = DATETIME("now") WHERE id = ?', [updated.join('\\n'), row.id]);
        changed += 1;
      }
    }
    res.json({ message: 'Lien partagé mis à jour.', changed });
  } catch (e) {
    res.status(400).json({ error: 'Lien invalide.' });
  }
});
`;

  return s.replace(marker, routes + '\n' + marker);
});

// ============================================
// App.js - Favoris
// ============================================
console.log('\n📌 APP.JS : Logique favoris + filtres');
console.log('━'.repeat(50));

safePatch('app.js', 'PATCH14_APP_FAVORITES', 'Logique favoris', (s) => {
  if (s.includes('state.favorites')) {
    console.log('✓ app.js : favoris déjà présents');
    skipCount++;
    return s;
  }

  const stateRe = /const state = \{([\s\S]*?)\n\};/;
  if (!stateRe.test(s)) return null;

  s = s.replace(stateRe, (m, body) => {
    if (body.includes('favorites:')) return m;
    return "const state = {" + body.replace(/currentUser:\s*null/, "currentUser: null,\n  favorites: new Set(),\n  activePersonalFilter: null") + "\n};";
  });

  const fn = `
async function loadFavorites() {
  if (!state.currentUser) { state.favorites = new Set(); return; }
  try {
    const r = await fetch('/api/favorites', { cache: 'no-store' });
    const d = await r.json();
    if (r.ok) state.favorites = new Set((d.favorites || []).map(Number));
  } catch (_) {}
}

async function toggleFavorite(id) {
  if (!state.currentUser) { alert('Connecte-toi pour utiliser les favoris.'); return; }
  const fav = state.favorites.has(id);
  const r = await fetch('/api/favorites/' + id, { method: fav ? 'DELETE' : 'POST' });
  const d = await r.json();
  if (!r.ok) { alert(d.error || 'Erreur.'); return; }
  if (fav) state.favorites.delete(id); else state.favorites.add(id);
  renderBoard();
}
`;

  if (!s.includes('async function loadFavorites()')) {
    const marker = 'async function loadManwhas() {';
    if (!s.includes(marker)) return null;
    s = s.replace(marker, fn + '\n\n' + marker);
  }

  const init = "checkAuth();\nloadManwhas();";
  if (s.includes(init) && !s.includes("loadFavorites();")) {
    s = s.replace(init, "checkAuth();\nloadManwhas();\nloadFavorites();");
  }

  return s.replace("const STATUS_META = {", "// PATCH14_APP_FAVORITES\nconst STATUS_META = {");
});

// ============================================
// HTML - Liens partagés
// ============================================
console.log('\n📌 HTML : Panneau liens partagés');
console.log('━'.repeat(50));

safePatch('index.html', 'id="sharedSourcesPanel"', 'Panneau liens partagés', (s) => {
  const marker = '<details id="sitePanel" class="fold hidden"';
  if (!s.includes(marker)) return null;

  const html = `        <details id="sharedSourcesPanel" class="fold hidden"><summary>Liens partagés</summary>\n          <p class="muted">Modifier un lien ici le met à jour partout.</p>\n          <div id="sharedSourcesList"></div>\n        </details>\n`;

  return s.replace(marker, html + marker);
});

// ============================================
// CSS - Favoris
// ============================================
console.log('\n📌 CSS : Styling favoris');
console.log('━'.repeat(50));

safePatch('styles.css', 'PATCH14_CSS', 'Styles favoris et liens', (s) => {
  if (s.includes('.favorite-button')) {
    console.log('✓ styles.css : styling déjà présent');
    skipCount++;
    return s;
  }

  const css = `

/* PATCH14_CSS - Favoris */
.favorite-button { position: absolute; top: 8px; right: 8px; width: 34px; height: 34px; border: 0; border-radius: 50%; background: rgba(0,0,0,.6); color: #fff; font-size: 18px; cursor: pointer; z-index: 3; transition: background 0.2s; }
.favorite-button:hover { background: rgba(0,0,0,.8); }
.favorite-button.active { background: rgba(245,158,11,.9); }
.shared-source-row { display: flex; justify-content: space-between; align-items: center; gap: 10px; border: 1px solid var(--border); border-radius: 10px; padding: 10px; margin-top: 8px; }
.shared-source-row div { flex: 1; min-width: 0; }
.shared-source-row strong { display: block; margin-bottom: 3px; }
.shared-source-row small { color: var(--muted); word-break: break-all; }
@media (max-width: 640px) { .shared-source-row { flex-direction: column; } .shared-source-row button { width: 100%; } }
`;

  return s.trimEnd() + css;
});

// ============================================
// Résumé final
// ============================================
console.log('\n' + '═'.repeat(50));
console.log('📊 RÉSUMÉ DU PATCH 14-SAFE v' + VERSION);
console.log('═'.repeat(50));
console.log(`✅ Succès        : ${successCount}`);
console.log(`⏭️  Déjà patché  : ${skipCount}`);
console.log(`❌ Erreurs       : ${errorCount}`);
console.log('═'.repeat(50));

if (errorCount === 0) {
  console.log('\n🎉 Patch appliqué avec succès!');
  console.log('\n📝 Prochaines étapes:');
  console.log('   1. Redémarrer le serveur : npm start');
  console.log('   2. Tester la connexion admin');
  console.log('   3. Tester la création d\'un filtre personnel');
  console.log('   4. Tester l\'ajout/suppression de favoris');
  console.log('   5. Tester la modification d\'un lien partagé (admin)');
  console.log('\n💾 Sauvegardes créées : fichiers *.backup.*');
  process.exit(0);
} else {
  console.log('\n⚠️  Patch incomplet - vérifier les erreurs ci-dessus');
  console.log('\n🔄 Restauration possible via les fichiers *.backup.*');
  process.exit(1);
}
