/**
 * GenzTech — Auth API
 * POST /api/auth/register  — Đăng ký: email + password + fb_token
 * POST /api/auth/login     — Đăng nhập: email + password
 * GET  /api/auth/me        — Lấy thông tin user hiện tại
 * POST /api/auth/update-token — Cập nhật FB token mới
 */
const express = require('express');
const bcrypt = require('bcryptjs');
const axios = require('axios');
const { authMiddleware, signToken } = require('../middleware/auth');

const router = express.Router();
const FB_GRAPH = 'https://graph.facebook.com/v19.0';

// ── Lazy-load DB (tránh lỗi nếu better-sqlite3 chưa cài) ─
let userStmt = null;
function getDb() {
  if (!userStmt) {
    try {
      const db = require('../db');
      userStmt = db.userStmt;
    } catch (e) {
      console.warn('[Auth] DB not available, using in-memory store:', e.message);
    }
  }
  return userStmt;
}

// ── In-memory fallback (backward compat) ─────────────────
const users = new Map();
let userIdCounter = 1;

// ── Helper: Lấy thông tin Facebook từ token ──────────────
async function fetchFbInfo(fbToken) {
  try {
    const meRes = await axios.get(`${FB_GRAPH}/me`, {
      params: { fields: 'id,name,picture.type(large)', access_token: fbToken },
      timeout: 10000,
    });
    const fbUser = meRes.data;

    const pagesRes = await axios.get(`${FB_GRAPH}/me/accounts`, {
      params: {
        fields: 'id,name,access_token,category,fan_count,picture',
        limit: 200,
        access_token: fbToken,
      },
      timeout: 15000,
    });
    const pages = pagesRes.data?.data || [];
    const fbTokenExp = new Date(Date.now() + 60 * 24 * 60 * 60 * 1000).toISOString();

    return {
      fb_user_id: fbUser.id,
      fb_user_name: fbUser.name,
      fb_avatar: fbUser.picture?.data?.url || null,
      fb_token: fbToken,
      fb_token_exp: fbTokenExp,
      fb_pages: JSON.stringify(pages),
      pages,
    };
  } catch (err) {
    const fbErr = err.response?.data?.error;
    const code = fbErr?.code;
    if (code === 190) throw new Error('Facebook Access Token không hợp lệ hoặc đã hết hạn');
    throw new Error('Không thể kết nối Facebook: ' + (fbErr?.message || err.message));
  }
}

function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

// ── POST /api/auth/register ──────────────────────────────
router.post('/register', async (req, res) => {
  try {
    const { email, password, fb_token } = req.body;

    if (!email || !password || !fb_token) {
      return res.status(400).json({ error: 'Email, mật khẩu và Facebook Access Token là bắt buộc' });
    }
    if (!isValidEmail(email)) {
      return res.status(400).json({ error: 'Email không hợp lệ' });
    }
    if (password.length < 6) {
      return res.status(400).json({ error: 'Mật khẩu tối thiểu 6 ký tự' });
    }

    const normalEmail = email.toLowerCase().trim();
    const stmt = getDb();

    // Kiểm tra email đã tồn tại
    if (stmt) {
      const existing = stmt.findByEmail.get(normalEmail);
      if (existing) return res.status(409).json({ error: 'Email này đã được đăng ký. Vui lòng đăng nhập.' });
    } else {
      for (const u of users.values()) {
        if (u.email === normalEmail) return res.status(409).json({ error: 'Email này đã được đăng ký.' });
      }
    }

    // Lấy thông tin Facebook
    let fbInfo;
    try {
      fbInfo = await fetchFbInfo(fb_token);
    } catch (fbErr) {
      return res.status(400).json({ error: fbErr.message });
    }

    const hashedPassword = await bcrypt.hash(password, 12);

    let userId;
    if (stmt) {
      // Lưu vào SQLite
      const result = stmt.create.run({
        email: normalEmail,
        password: hashedPassword,
        fb_user_id: fbInfo.fb_user_id,
        fb_user_name: fbInfo.fb_user_name,
        fb_avatar: fbInfo.fb_avatar,
        fb_token: fbInfo.fb_token,
        fb_token_exp: fbInfo.fb_token_exp,
        fb_pages: fbInfo.fb_pages,
      });
      userId = result.lastInsertRowid;
    } else {
      // Fallback: in-memory
      userId = String(userIdCounter++);
      users.set(normalEmail, {
        id: userId, email: normalEmail, password: hashedPassword,
        ...fbInfo, createdAt: new Date().toISOString()
      });
    }

    const token = signToken({ id: userId, email: normalEmail });
    console.log(`[Auth/Register] New user: ${normalEmail} | FB: ${fbInfo.fb_user_name} | Pages: ${fbInfo.pages.length}`);

    res.status(201).json({
      success: true,
      token,
      user: {
        id: userId,
        email: normalEmail,
        fb_user_id: fbInfo.fb_user_id,
        fb_user_name: fbInfo.fb_user_name,
        fb_avatar: fbInfo.fb_avatar,
        fb_token: fbInfo.fb_token,
        fb_token_exp: fbInfo.fb_token_exp,
        pages: fbInfo.pages,
        pages_count: fbInfo.pages.length,
      },
    });
  } catch (err) {
    console.error('[Auth/Register]', err.message);
    res.status(500).json({ error: 'Lỗi đăng ký: ' + err.message });
  }
});

// ── POST /api/auth/login ─────────────────────────────────
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ error: 'Email và mật khẩu là bắt buộc' });
    }

    const normalEmail = email.toLowerCase().trim();
    const stmt = getDb();

    let user;
    if (stmt) {
      user = stmt.findByEmail.get(normalEmail);
    } else {
      user = users.get(normalEmail);
    }

    if (!user) return res.status(401).json({ error: 'Email hoặc mật khẩu không đúng' });

    const valid = await bcrypt.compare(password, user.password);
    if (!valid) return res.status(401).json({ error: 'Email hoặc mật khẩu không đúng' });

    if (stmt) stmt.updateLastLogin.run(user.id);

    const token = signToken({ id: user.id, email: user.email });

    let pages = [];
    try { pages = JSON.parse(user.fb_pages || '[]'); } catch {}

    console.log(`[Auth/Login] User: ${user.email} | FB: ${user.fb_user_name}`);

    res.json({
      success: true,
      token,
      user: {
        id: user.id,
        email: user.email,
        fb_user_id: user.fb_user_id,
        fb_user_name: user.fb_user_name,
        fb_avatar: user.fb_avatar,
        fb_token: user.fb_token,
        fb_token_exp: user.fb_token_exp,
        pages,
        pages_count: pages.length,
        last_login: user.last_login,
        created_at: user.created_at,
      },
    });
  } catch (err) {
    console.error('[Auth/Login]', err.message);
    res.status(500).json({ error: 'Lỗi đăng nhập: ' + err.message });
  }
});

// ── GET /api/auth/me ─────────────────────────────────────
router.get('/me', authMiddleware, (req, res) => {
  try {
    const stmt = getDb();
    let user;
    if (stmt) {
      user = stmt.findById.get(req.user.id);
    } else {
      for (const u of users.values()) {
        if (String(u.id) === String(req.user.id)) { user = u; break; }
      }
    }
    if (!user) return res.status(404).json({ error: 'Không tìm thấy tài khoản' });

    let pages = [];
    try { pages = JSON.parse(user.fb_pages || '[]'); } catch {}

    res.json({
      id: user.id,
      email: user.email,
      fb_user_id: user.fb_user_id,
      fb_user_name: user.fb_user_name,
      fb_avatar: user.fb_avatar,
      fb_token: user.fb_token,
      fb_token_exp: user.fb_token_exp,
      pages,
      pages_count: pages.length,
      last_login: user.last_login,
      created_at: user.created_at,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── POST /api/auth/update-token ──────────────────────────
router.post('/update-token', authMiddleware, async (req, res) => {
  try {
    const { fb_token } = req.body;
    if (!fb_token) return res.status(400).json({ error: 'fb_token là bắt buộc' });

    let fbInfo;
    try {
      fbInfo = await fetchFbInfo(fb_token);
    } catch (fbErr) {
      return res.status(400).json({ error: fbErr.message });
    }

    const stmt = getDb();
    if (stmt) {
      stmt.updateFbInfo.run({
        id: req.user.id,
        fb_user_id: fbInfo.fb_user_id,
        fb_user_name: fbInfo.fb_user_name,
        fb_avatar: fbInfo.fb_avatar,
        fb_token: fbInfo.fb_token,
        fb_token_exp: fbInfo.fb_token_exp,
        fb_pages: fbInfo.fb_pages,
      });
    }

    res.json({
      success: true,
      message: `Đã cập nhật token. Tìm thấy ${fbInfo.pages.length} Pages.`,
      fb_user_name: fbInfo.fb_user_name,
      pages_count: fbInfo.pages.length,
      fb_token: fbInfo.fb_token,
      pages: fbInfo.pages,
    });
  } catch (err) {
    console.error('[Auth/UpdateToken]', err.message);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
module.exports.users = users; // backward compat
