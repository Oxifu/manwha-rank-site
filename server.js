const express = require('express');
const path = require('path');
const fs = require('fs');
const bcrypt = require('bcryptjs');
const sqlite3 = require('sqlite3').verbose();
const session = require('express-session');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const { body, validationResult } = require('express-validator');
require('dotenv').config();

const app = express();
const PORT = Number(process.env.PORT) || 3000;
const DB_DIR = path.join(__dirname, 'data');
const DB_PATH = path.join(DB_DIR, 'manwhas.db');

fs.mkdirSync(DB_DIR, { recursive: true });

const db = new sqlite3.Database(DB_PATH);

const STATUS_LABELS = {
  reading: 'Lecture',
  upcoming: 'À venir',
  missing: 'Introuvable',
  abandoned_translation: 'Abandon team trad',
  abandoned_creator: 'Abandon créateur',
  abandoned_manual: 'Abandon manuel',
  analysis_under_30: 'Analyse -30 chapitres',
  to_analyze: 'À analyser',
  finished: 'Terminé'
};

function dbRun(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function (err) {
      if (err) return reject(err);
      resolve(this);
    });
  });
}

function dbGet(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => {
      if (err) return reject(err);
      resolve(row);
    });
  });
}

function dbAll(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => {
      if (err) return reject(err);
      resolve(rows);
    });
  });
}

async function seedDatabase() {
  await dbRun(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'editor',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await dbRun(`
    CREATE TABLE IF NOT EXISTS manwhas (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      description TEXT,
      cover_image TEXT,
      genre TEXT,
      chapter_count INTEGER DEFAULT 0,
      status TEXT NOT NULL,
      notes TEXT,
      created_by INTEGER,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (created_by) REFERENCES users(id)
    )
  `);

  const adminUsername = process.env.ADMIN_USERNAME || 'admin';
  const adminPassword = process.env.ADMIN_PASSWORD || 'ChangeMe123!';

  const existingAdmin = await dbGet('SELECT id FROM users WHERE username = ?', [adminUsername]);

  if (!existingAdmin) {
    const passwordHash = await bcrypt.hash(adminPassword, 12);
    await dbRun(
      'INSERT INTO users (username, password_hash, role, created_at) VALUES (?, ?, ?, DATETIME("now"))',
      [adminUsername, passwordHash, 'admin']
    );
  }

  const count = await dbGet('SELECT COUNT(*) as count FROM manwhas');
  if (!count || count.count === 0) {
    const sample = [
      {
        title: 'Solo Leveling',
        description: 'Un système brutal, des combats rapides et une progression très satisfaisante.',
        cover_image: 'https://images.unsplash.com/photo-1518770660439-4636190af475?auto=format&fit=crop&w=900&q=80',
        genre: 'Isekai',
        chapter_count: 200,
        status: 'reading',
        notes: 'Toujours en lecture, très bon rythme.'
      },
      {
        title: 'The Beginning After the End',
        description: 'Un héros puissant, une histoire d’évolution et un monde riche.',
        cover_image: 'https://images.unsplash.com/photo-1526379095098-d400fd0bf935?auto=format&fit=crop&w=900&q=80',
        genre: 'Murim',
        chapter_count: 175,
        status: 'reading',
        notes: 'Très bon renouvellement du schéma classique.'
      },
      {
        title: 'Abyssal Tale',
        description: 'Un titre très prometteur, mais pas beaucoup de mise à jour récente.',
        cover_image: 'https://images.unsplash.com/photo-1504384308090-c894fdcc538d?auto=format&fit=crop&w=900&q=80',
        genre: 'Monde moderne',
        chapter_count: 28,
        status: 'analysis_under_30',
        notes: 'À surveiller pendant plusieurs mois.'
      },
      {
        title: 'The Last Hero',
        description: 'Disponible dans le backlog pour affiner la catégorie de lecture.',
        cover_image: 'https://images.unsplash.com/photo-1477959858617-67f85cf4f1df?auto=format&fit=crop&w=900&q=80',
        genre: 'Isekai',
        chapter_count: 14,
        status: 'to_analyze',
        notes: 'À analyser et à trier.'
      },
      {
        title: 'Ancient Eclipse',
        description: 'Dernière mise à jour impossible à confirmer, très probablement abandonné.',
        cover_image: 'https://images.unsplash.com/photo-1493246507139-91e8fad9978e?auto=format&fit=crop&w=900&q=80',
        genre: 'Murim',
        chapter_count: 42,
        status: 'abandoned_creator',
        notes: 'Abandon de la part du créateur.'
      }
    ];

    for (const item of sample) {
      await dbRun(
        `INSERT INTO manwhas (title, description, cover_image, genre, chapter_count, status, notes, created_by, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, DATETIME("now"))`,
        [item.title, item.description, item.cover_image, item.genre, item.chapter_count, item.status, item.notes, 1]
      );
    }
  }
}

app.use(
  helmet({
    crossOriginResourcePolicy: { policy: 'cross-origin' },
    contentSecurityPolicy: false
  })
);

app.use(
  session({
    secret: process.env.SESSION_SECRET || 'change-this-secret',
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      maxAge: 1000 * 60 * 60 * 8
    }
  })
);

app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true }));

const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 200,
  standardHeaders: true,
  legacyHeaders: false
});
app.use('/api', apiLimiter);

function requireAuth(req, res, next) {
  if (!req.session || !req.session.user) {
    return res.status(401).json({ error: 'Authentication requise.' });
  }
  next();
}

function sanitizeManhwa(row) {
  return {
    id: row.id,
    title: row.title,
    description: row.description || '',
    cover_image: row.cover_image || '',
    genre: row.genre || 'Autre',
    chapter_count: Number(row.chapter_count || 0),
    status: row.status,
    status_label: STATUS_LABELS[row.status] || row.status,
    notes: row.notes || '',
    updated_at: row.updated_at
  };
}

app.get('/api/health', (req, res) => {
  res.json({ ok: true, message: 'Serveur opérationnel.' });
});

app.get('/api/me', (req, res) => {
  if (!req.session || !req.session.user) {
    return res.json({ user: null });
  }

  res.json({ user: req.session.user });
});

app.post('/api/login', async (req, res) => {
  const { username, password } = req.body;

  if (!username || !password) {
    return res.status(400).json({ error: 'Nom d’utilisateur et mot de passe requis.' });
  }

  try {
    const user = await dbGet('SELECT id, username, password_hash, role FROM users WHERE username = ?', [username.trim()]);
    if (!user) {
      return res.status(401).json({ error: 'Identifiants invalides.' });
    }

    const isValidPassword = await bcrypt.compare(password, user.password_hash);
    if (!isValidPassword) {
      return res.status(401).json({ error: 'Identifiants invalides.' });
    }

    req.session.user = { id: user.id, username: user.username, role: user.role };
    res.json({ message: 'Connexion réussie.', user: req.session.user });
  } catch (error) {
    console.error('Erreur login :', error);
    res.status(500).json({ error: 'Erreur serveur.' });
  }
});

app.post('/api/logout', (req, res) => {
  req.session.destroy(() => {
    res.json({ success: true, message: 'Déconnecté.' });
  });
});

app.get('/api/manwhas', async (req, res) => {
  try {
    const rows = await dbAll(
      `SELECT * FROM manwhas ORDER BY CASE status
        WHEN 'reading' THEN 1
        WHEN 'upcoming' THEN 2
        WHEN 'finished' THEN 3
        WHEN 'analysis_under_30' THEN 4
        WHEN 'to_analyze' THEN 5
        WHEN 'missing' THEN 6
        WHEN 'abandoned_translation' THEN 7
        WHEN 'abandoned_creator' THEN 8
        WHEN 'abandoned_manual' THEN 9
        ELSE 10
      END, title ASC`
    );

    res.json({ manwhas: rows.map(sanitizeManhwa) });
  } catch (error) {
    console.error('Erreur /api/manwhas :', error);
    res.status(500).json({ error: 'Impossible de récupérer les manwhas.' });
  }
});

app.get('/api/admin/users', requireAuth, async (req, res) => {
  if (req.session.user.role !== 'admin') {
    return res.status(403).json({ error: 'Accès refusé.' });
  }

  try {
    const users = await dbAll('SELECT id, username, role, created_at FROM users ORDER BY username ASC');
    res.json({ users });
  } catch (error) {
    console.error('Erreur /api/admin/users :', error);
    res.status(500).json({ error: 'Impossible de récupérer les utilisateurs.' });
  }
});

app.post(
  '/api/admin/users',
  requireAuth,
  [
    body('username').trim().isLength({ min: 3, max: 30 }).withMessage('Nom d’utilisateur invalide. 3 à 30 caractères.'),
    body('password').isLength({ min: 6 }).withMessage('Le mot de passe doit contenir au moins 6 caractères.'),
    body('role').optional().isIn(['admin', 'editor']).withMessage('Rôle invalide.')
  ],
  async (req, res) => {
    if (req.session.user.role !== 'admin') {
      return res.status(403).json({ error: 'Accès refusé.' });
    }

    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { username, password, role = 'editor' } = req.body;

    try {
      const existing = await dbGet('SELECT id FROM users WHERE username = ?', [username.trim()]);
      if (existing) {
        return res.status(409).json({ error: 'Ce nom d’utilisateur existe déjà.' });
      }

      const passwordHash = await bcrypt.hash(password, 12);
      const result = await dbRun(
        'INSERT INTO users (username, password_hash, role, created_at) VALUES (?, ?, ?, DATETIME("now"))',
        [username.trim(), passwordHash, role]
      );

      res.status(201).json({
        message: 'Compte utilisateur créé.',
        user: { id: result.lastID, username: username.trim(), role }
      });
    } catch (error) {
      console.error('Erreur création utilisateur :', error);
      res.status(500).json({ error: 'Erreur serveur.' });
    }
  }
);

app.post(
  '/api/admin/manwhas',
  requireAuth,
  [
    body('title').trim().isLength({ min: 2, max: 200 }).withMessage('Titre invalide.'),
    body('genre').trim().isLength({ min: 2, max: 80 }).withMessage('Genre invalide.'),
    body('status').isIn([
      'reading',
      'upcoming',
      'missing',
      'abandoned_translation',
      'abandoned_creator',
      'abandoned_manual',
      'analysis_under_30',
      'to_analyze',
      'finished'
    ]).withMessage('Statut invalide.'),
    body('chapter_count').optional().isInt({ min: 0 }).withMessage('Nombre de chapitres invalide.')
  ],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { title, description, cover_image, genre, chapter_count, status, notes } = req.body;

    try {
      const result = await dbRun(
        `INSERT INTO manwhas (title, description, cover_image, genre, chapter_count, status, notes, created_by, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, DATETIME("now"))`,
        [title.trim(), description || '', cover_image || '', genre.trim(), Number(chapter_count || 0), status, notes || '', req.session.user.id]
      );

      const created = await dbGet('SELECT * FROM manwhas WHERE id = ?', [result.lastID]);
      res.status(201).json({ manhwa: sanitizeManhwa(created) });
    } catch (error) {
      console.error('Erreur ajout manhwa :', error);
      res.status(500).json({ error: 'Impossible d’ajouter le manhwa.' });
    }
  }
);

app.put(
  '/api/admin/manwhas/:id',
  requireAuth,
  [
    body('title').optional().trim().isLength({ min: 2, max: 200 }).withMessage('Titre invalide.'),
    body('genre').optional().trim().isLength({ min: 2, max: 80 }).withMessage('Genre invalide.'),
    body('status').optional().isIn([
      'reading',
      'upcoming',
      'missing',
      'abandoned_translation',
      'abandoned_creator',
      'abandoned_manual',
      'analysis_under_30',
      'to_analyze',
      'finished'
    ]).withMessage('Statut invalide.'),
    body('chapter_count').optional().isInt({ min: 0 }).withMessage('Nombre de chapitres invalide.')
  ],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    try {
      const existing = await dbGet('SELECT * FROM manwhas WHERE id = ?', [req.params.id]);
      if (!existing) {
        return res.status(404).json({ error: 'Manhwa introuvable.' });
      }

      const updates = {
        title: req.body.title ? req.body.title.trim() : existing.title,
        description: req.body.description !== undefined ? req.body.description : existing.description,
        cover_image: req.body.cover_image !== undefined ? req.body.cover_image : existing.cover_image,
        genre: req.body.genre ? req.body.genre.trim() : existing.genre,
        chapter_count: req.body.chapter_count !== undefined ? Number(req.body.chapter_count) : existing.chapter_count,
        status: req.body.status || existing.status,
        notes: req.body.notes !== undefined ? req.body.notes : existing.notes
      };

      await dbRun(
        `UPDATE manwhas
         SET title = ?, description = ?, cover_image = ?, genre = ?, chapter_count = ?, status = ?, notes = ?, updated_at = DATETIME("now")
         WHERE id = ?`,
        [updates.title, updates.description, updates.cover_image, updates.genre, updates.chapter_count, updates.status, updates.notes, req.params.id]
      );

      const updated = await dbGet('SELECT * FROM manwhas WHERE id = ?', [req.params.id]);
      res.json({ manhwa: sanitizeManhwa(updated) });
    } catch (error) {
      console.error('Erreur modification manhwa :', error);
      res.status(500).json({ error: 'Impossible de modifier le manhwa.' });
    }
  }
);

app.delete('/api/admin/manwhas/:id', requireAuth, async (req, res) => {
  try {
    const existing = await dbGet('SELECT id FROM manwhas WHERE id = ?', [req.params.id]);
    if (!existing) {
      return res.status(404).json({ error: 'Manhwa introuvable.' });
    }

    await dbRun('DELETE FROM manwhas WHERE id = ?', [req.params.id]);
    res.json({ success: true, message: 'Manhwa supprimé.' });
  } catch (error) {
    console.error('Erreur suppression manhwa :', error);
    res.status(500).json({ error: 'Impossible de supprimer le manhwa.' });
  }
});

app.use(express.static(path.join(__dirname, 'public')));

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

async function startServer() {
  await seedDatabase();
  app.listen(PORT, () => {
    console.log(`Serveur démarré sur http://localhost:${PORT}`);
  });
}

startServer().catch((error) => {
  console.error('Erreur de démarrage du serveur :', error);
  process.exit(1);
});
