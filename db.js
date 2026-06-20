/* db.js — pure-JS JSON flat-file database (no native modules) */

const fs   = require('fs');
const path = require('path');

const FILE = path.join(__dirname, 'argueout-data.json');

function load() {
  try {
    return JSON.parse(fs.readFileSync(FILE, 'utf8'));
  } catch {
    return { users: {}, debates: {} };
  }
}

function save(data) {
  fs.writeFileSync(FILE, JSON.stringify(data, null, 2), 'utf8');
}

// ── Users ─────────────────────────────────────────────────────

function getUser(id) {
  return load().users[id] || null;
}

function getUserByUsername(username) {
  const data = load();
  return Object.values(data.users).find(u => u.username === username) || null;
}

function createUser(user) {
  const data = load();
  data.users[user.id] = user;
  save(data);
}

function updateCompass(id, politicalX, politicalY) {
  const data = load();
  if (!data.users[id]) return;
  data.users[id].political_x  = politicalX;
  data.users[id].political_y  = politicalY;
  data.users[id].compass_set  = true;
  save(data);
}

function safeUser(u) {
  if (!u) return null;
  const { password_hash, ...rest } = u;
  return rest;
}

// ── Debates ───────────────────────────────────────────────────

function createDebate(debate) {
  const data = load();
  data.debates[debate.id] = debate;
  save(data);
}

function endDebate(id) {
  const data = load();
  if (!data.debates[id]) return;
  data.debates[id].ended_at = new Date().toISOString();
  save(data);
}

module.exports = {
  getUser, getUserByUsername, createUser, updateCompass, safeUser,
  createDebate, endDebate
};
