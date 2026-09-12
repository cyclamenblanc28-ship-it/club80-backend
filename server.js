const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const cors = require('cors');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Initialisation de la base de données SQLite
const db = new sqlite3.Database('./database.sqlite', (err) => {
  if (err) console.error("Erreur de connexion SQLite:", err.message);
  else console.log("Connecté à la base de données SQLite.");
});

// Création des tables
db.serialize(() => {
  db.run(`CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE,
    name TEXT,
    avatar TEXT,
    bio TEXT,
    status TEXT DEFAULT 'PENDING' -- PENDING, ACCEPTED, REJECTED
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS votes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    voterId INTEGER,
    candidateId INTEGER,
    decision INTEGER, -- 1 pour Accepter, 0 pour Refuser
    UNIQUE(voterId, candidateId)
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS stories (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    userId INTEGER,
    media TEXT,
    caption TEXT,
    createdAt DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS jobs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    userId INTEGER,
    type TEXT, -- OFFRE ou ENTRAIDE
    title TEXT,
    company TEXT,
    location TEXT,
    desc TEXT,
    createdAt DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);

  // Insertion d'un jeu de données initial si la table est vide
  db.get("SELECT COUNT(*) AS count FROM users", (err, row) => {
    if (row.count === 0) {
      db.run(`INSERT INTO users (username, name, avatar, bio, status) VALUES 
        ('admin_alex', 'Alexandre', 'https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?w=150', 'Fondateur du Club.', 'ACCEPTED'),
        ('claire_d', 'Claire Dupont', 'https://images.unsplash.com/photo-1494790108377-be9c29b29330?w=150', 'UI/UX Designer', 'PENDING'),
        ('lucas_m', 'Lucas Martin', 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=150', 'Développeur Mobile', 'PENDING')
      `);
      db.run(`INSERT INTO stories (userId, media, caption) VALUES 
        (1, 'https://images.unsplash.com/photo-1517248135467-4c7edcad34c4?w=600', 'Lancement officiel du Club ! 🚀')
      `);
      db.run(`INSERT INTO jobs (userId, type, title, company, location, desc) VALUES 
        (1, 'OFFRE', 'Lead Designer', 'Studio Créatif', 'Paris / Remote', 'Recherche un designer senior pour projet de 6 mois.')
      `);
    }
  });
});

// --- ROUTES API ---

// 1. Récupérer les candidats en attente de validation
app.get('/api/candidates', (req, res) => {
  const query = `
    SELECT u.*, 
      SUM(CASE WHEN v.decision = 1 THEN 1 ELSE 0 END) as votesFor,
      SUM(CASE WHEN v.decision = 0 THEN 1 ELSE 0 END) as votesAgainst,
      COUNT(v.id) as totalVotes
    FROM users u
    LEFT JOIN votes v ON u.id = v.candidateId
    WHERE u.status = 'PENDING'
    GROUP BY u.id
  `;
  db.all(query, [], (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(rows.map(r => ({ ...r, votesFor: r.votesFor || 0, votesAgainst: r.votesAgainst || 0 })));
  });
});

// 2. Soumettre un vote et appliquer la règle d'admission à 80%
app.post('/api/vote', (req, res) => {
  const { voterId, candidateId, decision } = req.body; // decision: 1 (Accepter) ou 0 (Refuser)

  db.run(`INSERT OR REPLACE INTO votes (voterId, candidateId, decision) VALUES (?, ?, ?)`,
    [voterId, candidateId, decision],
    function(err) {
      if (err) return res.status(500).json({ error: err.message });

      // Vérification des quotas de votes
      db.all(`SELECT decision FROM votes WHERE candidateId = ?`, [candidateId], (err, votes) => {
        const total = votes.length;
        const accepted = votes.filter(v => v.decision === 1).length;
        const ratio = accepted / total;

        // Seuil d'acceptation : au moins 3 votes requis et 80% de validation
        if (total >= 3 && ratio >= 0.80) {
          db.run(`UPDATE users SET status = 'ACCEPTED' WHERE id = ?`, [candidateId]);
        } else if (total >= 3 && ratio < 0.80) {
          db.run(`UPDATE users SET status = 'REJECTED' WHERE id = ?`, [candidateId]);
        }

        res.json({ success: true, ratio: Math.round(ratio * 100), totalVotes: total });
      });
    }
  );
});

// 3. Inscrire un nouveau candidat
app.post('/api/register', (req, res) => {
  const { username, name, avatar, bio } = req.body;
  db.run(`INSERT INTO users (username, name, avatar, bio, status) VALUES (?, ?, ?, ?, 'PENDING')`,
    [username, name, avatar || 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=150', bio],
    function(err) {
      if (err) return res.status(400).json({ error: "Ce nom d'utilisateur existe déjà." });
      res.json({ success: true, id: this.lastID });
    }
  );
});

// 4. Récupérer les Stories
app.get('/api/stories', (req, res) => {
  const query = `
    SELECT s.*, u.username, u.name, u.avatar 
    FROM stories s 
    JOIN users u ON s.userId = u.id 
    ORDER BY s.createdAt DESC
  `;
  db.all(query, [], (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(rows);
  });
});

// 5. Publier une Story
app.post('/api/stories', (req, res) => {
  const { userId, media, caption } = req.body;
  db.run(`INSERT INTO stories (userId, media, caption) VALUES (?, ?, ?)`,
    [userId, media, caption],
    function(err) {
      if (err) return res.status(500).json({ error: err.message });
      res.json({ success: true, id: this.lastID });
    }
  );
});

// 6. Récupérer les Annonces Emploi / Aide
app.get('/api/jobs', (req, res) => {
  const query = `
    SELECT j.*, u.name as author, u.avatar 
    FROM jobs j 
    JOIN users u ON j.userId = u.id 
    ORDER BY j.createdAt DESC
  `;
  db.all(query, [], (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(rows);
  });
});

// 7. Publier une annonce Emploi / Aide
app.post('/api/jobs', (req, res) => {
  const { userId, type, title, company, location, desc } = req.body;
  db.run(`INSERT INTO jobs (userId, type, title, company, location, desc) VALUES (?, ?, ?, ?, ?, ?)`,
    [userId, type, title, company, location, desc],
    function(err) {
      if (err) return res.status(500).json({ error: err.message });
      res.json({ success: true, id: this.lastID });
    }
  );
});

app.listen(PORT, () => {
  console.log(`Serveur V2 démarré sur http://localhost:${PORT}`);
});