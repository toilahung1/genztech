const express  = require('express');
const bcrypt   = require('bcryptjs');
const jwt      = require('jsonwebtoken');
const { userStmt } = require('../database');

const router = express.Router();

// Kiểm tra độ mạnh mật khẩu
function validatePassword(password) {
  if (!password || password.length < 8) return 'Mật khẩu tối thiểu 8 ký tự';
  if (!/[a-zA-Z]/.test(password))       return 'Mật khẩu phải chứa ít nhất 1 chữ cái';
  if (!/[0-9]/.test(password))          return 'Mật khẩu phải chứa ít nhất 1 chữ số';
  return null;
}

// POST /api/auth/register
router.post('/register', async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) return res.status(400).json({ error: 'username và password là bắt buộc' });
  if (username.length < 3) return res.status(400).json({ error: 'Username tối thiểu 3 ký tự' });

  const pwErr = validatePassword(password);
  if (pwErr) return res.status(400).json({ error: pwErr });

  try {
    const existing = await userStmt.findByUsername(username);
    if (existing) return res.status(409).json({ error: 'Username đã tồn tại' });

    const hash = await bcrypt.hash(password, 12);
    const info = await userStmt.create(username, hash);
    const token = jwt.sign({ userId: info.id, username }, process.env.JWT_SECRET, { expiresIn: '30d' });

    res.json({ success: true, token, username });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/auth/login
router.post('/login', async (req, res) => {
  // Chấp nhận cả 'username' và 'email' field (backward compatible)
  const { username, email, password } = req.body;
  const loginId = username || email;
  if (!loginId || !password) return res.status(400).json({ error: 'Thiếu thông tin đăng nhập' });

  try {
    const user = await userStmt.findByUsername(loginId);
    if (!user) return res.status(401).json({ error: 'Sai username hoặc password' });

    const ok = await bcrypt.compare(password, user.password);
    if (!ok) return res.status(401).json({ error: 'Sai username hoặc password' });

    await userStmt.updateLogin(user.id);
    const token = jwt.sign({ userId: user.id, username: user.username }, process.env.JWT_SECRET, { expiresIn: '30d' });

    res.json({ success: true, token, username: user.username });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
