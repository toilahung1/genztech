const express = require('express');
const bcrypt = require('bcryptjs');
const { authMiddleware, signToken } = require('../middleware/auth');
const router = express.Router();

// In-memory user store (persists while server is running)
// For production with persistence, add PostgreSQL later
const users = new Map(); // username -> { id, username, email, password, fbToken, fbUserId, fbTokenExp, createdAt }
let userIdCounter = 1;

function findUser(username) {
  for (const u of users.values()) {
    if (u.username === username || u.email === username) return u;
  }
  return null;
}

// POST /api/auth/register
router.post('/register', async (req, res) => {
  try {
    const { username, email, password } = req.body;
    if (!username || !password) return res.status(400).json({ error: 'Thiếu username hoặc password' });
    if (password.length < 6) return res.status(400).json({ error: 'Mật khẩu tối thiểu 6 ký tự' });
    if (username.length < 3) return res.status(400).json({ error: 'Username tối thiểu 3 ký tự' });

    // Check duplicate
    if (users.has(username)) return res.status(409).json({ error: 'Username đã tồn tại' });
    if (email) {
      for (const u of users.values()) {
        if (u.email === email) return res.status(409).json({ error: 'Email đã được sử dụng' });
      }
    }

    const hashed = await bcrypt.hash(password, 10);
    const id = String(userIdCounter++);
    const user = { id, username, email: email || null, password: hashed, fbToken: null, fbUserId: null, fbTokenExp: null, createdAt: new Date().toISOString() };
    users.set(username, user);

    const token = signToken({ id, username, email: email || null });
    res.status(201).json({ success: true, token, user: { id, username, email: email || null } });
  } catch (e) {
    console.error('[Auth/Register]', e.message);
    res.status(500).json({ error: 'Lỗi đăng ký. Vui lòng thử lại.' });
  }
});

// POST /api/auth/login
router.post('/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    if (!username || !password) return res.status(400).json({ error: 'Thiếu username hoặc password' });

    const user = findUser(username);
    if (!user) return res.status(401).json({ error: 'Sai username hoặc password' });

    const valid = await bcrypt.compare(password, user.password);
    if (!valid) return res.status(401).json({ error: 'Sai username hoặc password' });

    const token = signToken({ id: user.id, username: user.username, email: user.email });
    res.json({ success: true, token, user: { id: user.id, username: user.username, email: user.email } });
  } catch (e) {
    console.error('[Auth/Login]', e.message);
    res.status(500).json({ error: 'Lỗi đăng nhập. Vui lòng thử lại.' });
  }
});

// GET /api/auth/me — decode JWT, no DB needed
router.get('/me', authMiddleware, (req, res) => {
  try {
    const { id, username, email, iat, exp } = req.user;
    // Try to get extra info from in-memory store
    const stored = users.get(username) || {};
    res.json({
      id,
      username,
      email: email || null,
      fbUserId: stored.fbUserId || null,
      fbTokenExp: stored.fbTokenExp || null,
      createdAt: stored.createdAt || null
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
module.exports.users = users; // Export for use in facebook.js
