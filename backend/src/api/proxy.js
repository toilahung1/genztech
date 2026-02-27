const express = require('express');
const axios = require('axios');
const { authMiddleware } = require('../middleware/auth');

const router = express.Router();
const FB_GRAPH = 'https://graph.facebook.com/v25.0';

// Helper: lấy FB token của user từ in-memory store
function getUserFbToken(userId) {
  const { users } = require('./auth');
  for (const u of users.values()) {
    if (u.id === userId) return u.fbToken || null;
  }
  return null;
}

// Helper: gọi Facebook API
async function fbGet(path, params) {
  const r = await axios.get(`${FB_GRAPH}/${path}`, { params, timeout: 15000 });
  return r.data;
}

async function fbPost(path, params) {
  const r = await axios.post(`${FB_GRAPH}/${path}`, null, { params, timeout: 15000 });
  return r.data;
}

// GET /api/facebook/proxy/my-ad-accounts
router.get('/my-ad-accounts', authMiddleware, async (req, res) => {
  try {
    const token = getUserFbToken(req.user.id);
    if (!token) return res.status(400).json({ error: 'Chưa kết nối Facebook. Vui lòng kết nối tại trang Tự Động Đăng Bài.' });

    const datePreset = req.query.date_preset || 'last_30d';
    const data = await fbGet('me/adaccounts', {
      fields: 'id,name,account_status,balance,currency,amount_spent,spend_cap,timezone_id,timezone_name,country',
      limit: 50,
      access_token: token
    });
    res.json({ accounts: data.data || [] });
  } catch (e) {
    const msg = e.response?.data?.error?.message || e.message;
    res.status(500).json({ error: msg });
  }
});

// GET /api/facebook/proxy/ad-account/:accountId — Campaigns của một TKQC
router.get('/ad-account/:accountId', authMiddleware, async (req, res) => {
  try {
    const token = getUserFbToken(req.user.id);
    if (!token) return res.status(400).json({ error: 'Chưa kết nối Facebook' });

    const { accountId } = req.params;
    const datePreset = req.query.date_preset || 'last_30d';

    const data = await fbGet(`${accountId}/campaigns`, {
      fields: 'id,name,status,objective,daily_budget,lifetime_budget,start_time,stop_time',
      limit: 100,
      access_token: token
    });
    const campaigns = data.data || [];

    // Fetch insights in parallel
    await Promise.all(campaigns.map(async c => {
      try {
        const ins = await fbGet(`${c.id}/insights`, {
          fields: 'spend,impressions,clicks,ctr,cpc,reach',
          date_preset: datePreset,
          access_token: token
        });
        c.insights = { data: ins.data || [] };
      } catch { c.insights = { data: [] }; }
    }));

    res.json({ campaigns });
  } catch (e) {
    const msg = e.response?.data?.error?.message || e.message;
    res.status(500).json({ error: msg });
  }
});

// POST /api/facebook/proxy/pause-campaigns
router.post('/pause-campaigns', authMiddleware, async (req, res) => {
  try {
    const token = getUserFbToken(req.user.id);
    if (!token) return res.status(400).json({ error: 'Chưa kết nối Facebook' });

    const { accountId, level, reason } = req.body;
    const data = await fbGet(`${accountId}/campaigns`, { fields: 'id,name,status', limit: 100, access_token: token });
    const active = (data.data || []).filter(c => c.status === 'ACTIVE');

    await Promise.all(active.map(c =>
      fbPost(`${c.id}`, { status: 'PAUSED', access_token: token }).catch(() => {})
    ));

    res.json({ success: true, paused: active.length, reason });
  } catch (e) {
    const msg = e.response?.data?.error?.message || e.message;
    res.status(500).json({ error: msg });
  }
});

// GET /api/facebook/proxy/find-id?query=...
router.get('/find-id', async (req, res) => {
  try {
    const { query } = req.query;
    if (!query) return res.status(400).json({ error: 'Thiếu query' });
    // Ưu tiên: token từ query param > Authorization header > FB_DEFAULT_TOKEN
    const authHeader = req.headers.authorization;
    const token = req.query.access_token ||
      (authHeader && authHeader.startsWith('Bearer ') ? null : authHeader) ||
      process.env.FB_DEFAULT_TOKEN;
    if (!token) return res.status(400).json({ error: 'Cần nhập Access Token để sử dụng tính năng này' });
    const data = await fbGet('', { id: query, access_token: token });
    res.json(data);
  } catch (e) {
    const msg = e.response?.data?.error?.message || e.message;
    res.status(500).json({ error: msg });
  }
});

// GET /api/facebook/proxy/ad-library
router.get('/ad-library', async (req, res) => {
  try {
    // Ưu tiên: token từ query param > FB_DEFAULT_TOKEN
    const token = req.query.access_token || process.env.FB_DEFAULT_TOKEN;
    if (!token) return res.status(400).json({ error: 'Cần nhập Access Token để sử dụng tính năng này' });
    const { access_token, ...restQuery } = req.query; // tách token khỏi params
    const params = { ...restQuery, access_token: token };
    const data = await fbGet('ads_archive', params);
    res.json(data);
  } catch (e) {
    const msg = e.response?.data?.error?.message || e.message;
    res.status(500).json({ error: msg });
  }
});

// Generic proxy — GET /api/facebook/proxy/:path (*)
router.get('/*', authMiddleware, async (req, res) => {
  try {
    const token = getUserFbToken(req.user.id);
    if (!token) return res.status(400).json({ error: 'Chưa kết nối Facebook' });

    const path = req.params[0];
    const data = await fbGet(path, { ...req.query, access_token: token });
    res.json(data);
  } catch (e) {
    const msg = e.response?.data?.error?.message || e.message;
    res.status(500).json({ error: msg });
  }
});

// Generic proxy — POST /api/facebook/proxy/:path (*)
router.post('/*', authMiddleware, async (req, res) => {
  try {
    const token = getUserFbToken(req.user.id);
    if (!token) return res.status(400).json({ error: 'Chưa kết nối Facebook' });

    const path = req.params[0];
    const data = await fbPost(path, { ...req.body, ...req.query, access_token: token });
    res.json(data);
  } catch (e) {
    const msg = e.response?.data?.error?.message || e.message;
    res.status(500).json({ error: msg });
  }
});

module.exports = router;
