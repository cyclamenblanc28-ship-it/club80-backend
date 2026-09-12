const express = require('express');
const cors = require('cors');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const app = express();
const PORT = process.env.PORT || 10000;

// Middlewares
app.use(cors());
app.use(express.json());

// Connexion / Création de la base de données SQLite
const dbPath = path.resolve(__dirname, 'club80.db');
const db = new sqlite3.Database(dbPath, (err) => {
  if (err) {
    console.error('Erreur lors de la connexion à SQLite :', err.message);
  } else {
    console.log('Connecté à la base de données SQLite.');
  }
});

// Initialisation des tables
db.serialize(() => {
  // Table des utilisateurs
  db.run(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE NOT NULL,
      password TEXT NOT NULL,
      avatar TEXT
    )
  `);

  // Table des stories
  db.run(`
    CREATE TABLE IF NOT EXISTS stories (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER,
      username TEXT,
      media_url TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(user_id) REFERENCES users(id)
    )
  `);
});

// -----------------------------------------------------------------------------
// ENDPOINTS API
// -----------------------------------------------------------------------------

// 1. Inscription d'un nouvel utilisateur
app.post('/register', (req, res) => {
  const { username, password, avatar } = req.body;

  if (!username || !password) {
    return res.status(400).json({ error: 'Identifiant et mot de passe requis.' });
  }

  const defaultAvatar = avatar || 'https://picsum.photos/200';
  const query = `INSERT INTO users (username, password, avatar) VALUES (?, ?, ?)`;

  db.run(query, [username, password, defaultAvatar], function (err) {
    if (err) {
      if (err.message.includes('UNIQUE')) {
        return res.status(400).json({ error: 'Ce nom d\'utilisateur existe déjà.' });
      }
      return res.status(500).json({ error: err.message });
    }
    res.json({
      success: true,
      user: { id: this.lastID, username, avatar: defaultAvatar }
    });
  });
});

// 2. Connexion utilisateur
app.post('/login', (req, res) => {
  const { username, password } = req.body;

  if (!username || !password) {
    return res.status(400).json({ error: 'Identifiant et mot de passe requis.' });
  }

  const query = `SELECT id, username, avatar FROM users WHERE username = ? AND password = ?`;

  db.get(query, [username, password], (err, row) => {
    if (err) {
      return res.status(500).json({ error: err.message });
    }
    if (!row) {
      return res.status(401).json({ error: 'Identifiants incorrects.' });
    }
    res.json({ success: true, user: row });
  });
});

// 3. Récupérer toutes les stories
app.get('/stories', (req, res) => {
  const query = `SELECT * FROM stories ORDER BY created_at DESC`;

  db.all(query, [], (err, rows) => {
    if (err) {
      return res.status(500).json({ error: err.message });
    }
    res.json({ stories: rows });
  });
});

// 4. Publier une nouvelle story
app.post('/stories', (req, res) => {
  const { user_id, username, media_url } = req.body;

  if (!media_url) {
    return res.status(400).json({ error: 'Une URL de média est requise.' });
  }

  const query = `INSERT INTO stories (user_id, username, media_url) VALUES (?, ?, ?)`;

  db.run(query, [user_id, username, media_url], function (err) {
    if (err) {
      return res.status(500).json({ error: err.message });
    }
    res.json({
      success: true,
      story: { id: this.lastID, user_id, username, media_url }
    });
  });
});

// Route de test
app.get('/', (req, res) => {
  res.send('Serveur Club 80 actif.');
});

// Démarrage du serveur
app.listen(PORT, () => {
  console.log(`Serveur V2 démarré sur le port ${PORT}`);
});
