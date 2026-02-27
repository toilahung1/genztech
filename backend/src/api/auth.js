const express = require('express');
const bcrypt = require('bcryptjs');
const { authMiddleware, signToken, prisma } = require('../middleware/auth');

const router = express.Router();

// POST /api/auth/register
router.post('/register', async (req, res) => {
  try {
    const { username, email, password } = req.body;
    if (!username || !password) return res.status(400).json({ error: 'Thiếu username hoặc password' });
    if (password.length < 6) return res.status(400).json({ error: 'Mật khẩu tối thiểu 6 ký tự' });
    if (username.length < 3) return res.status(400).json({ error: 'Username tối thiểu 3 ký tự' });

    // Check duplicate
    const existing = await prisma.user.findFirst({ where: { OR: [{ username }, ...(email ? [{ email }] : [])] } });
    if (existing) return res.status(409).json({ error: existing.username === username ? 'Username đã tồn tại' : 'Email đã được sử dụng' });

    const hashed = await bcrypt.hash(password, 10);
    const user = await prisma.user.create({ data: { username, email: email || null, password: hashed } });

    const token = signToken({ id: user.id, username: user.username, email: user.email });
    res.status(201).json({ success: true, token, user: { id: user.id, username: user.username, email: user.email } });
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

    const user = await prisma.user.findFirst({ where: { OR: [{ username }, { email: username }] } });
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

// GET /api/auth/me
router.get('/me', authMiddleware, async (req, res) => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.user.id },
      select: { id: true, username: true, email: true, createdAt: true, fbUserId: true, fbTokenExp: true }
    });
    if (!user) return res.status(404).json({ error: 'Người dùng không tồn tại' });
    res.json(user);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
