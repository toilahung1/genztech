const express  = require('express');
const bcrypt   = require('bcryptjs');
const jwt      = require('jsonwebtoken');
const { userStmt } = require('../database');

const router = express.Router();

// POST /api/auth/register
router.post('/register', async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) return res.status(400).json({ error: 'username và password là bắt buộc' });
  if (password.length < 6) return res.status(400).json({ error: 'Password tối thiểu 6 ký tự' });

  try {
    const existing = userStmt.findByUsername.get(username);
    if (existing) return res.status(409).json({ error: 'Username đã tồn tại' });

    const hash = await bcrypt.hash(password, 12);
    const info = userStmt.create.run(username, hash);
    const token = jwt.sign({ userId: info.lastInsertRowid, username }, process.env.JWT_SECRET, { expiresIn: '30d' });

    res.json({ success: true, token, username });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/auth/login
router.post('/login', async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) return res.status(400).json({ error: 'Thiếu thông tin đăng nhập' });

  try {
    const user = userStmt.findByUsername.get(username);
    if (!user) return res.status(401).json({ error: 'Sai username hoặc password' });

    const ok = await bcrypt.compare(password, user.password);
    if (!ok) return res.status(401).json({ error: 'Sai username hoặc password' });

    userStmt.updateLogin.run(user.id);
    const token = jwt.sign({ userId: user.id, username: user.username }, process.env.JWT_SECRET, { expiresIn: '30d' });

    res.json({ success: true, token, username: user.username });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
