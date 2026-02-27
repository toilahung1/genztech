require('dotenv').config();
const express = require('express');
const cors = require('cors');
const axios = require('axios');

const app = express();
const PORT = process.env.PORT || 3000;
const FB_GRAPH = 'https://graph.facebook.com/v25.0';

// ── Middleware ──
app.use(cors({ origin: '*' }));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// ── In-memory user store (simple, no DB needed) ──
const users = new Map();
const JWT_SECRET = process.env.JWT_SECRET || 'genztech_secret_2025';

function generateToken(user) {
  const payload = { id: user.id, username: user.username, email: user.email, iat: Date.now() };
  return Buffer.from(JSON.stringify(payload)).toString('base64');
}

function verifyToken(token) {
  try {
    return JSON.parse(Buffer.from(token, 'base64').toString());
  } catch (e) {
    return null;
  }
}

function authMiddleware(req, res, next) {
  const auth = req.headers.authorization;
  if (!auth || !auth.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Chưa đăng nhập' });
  }
  const token = auth.slice(7);
  const user = verifyToken(token);
  if (!user) return res.status(401).json({ error: 'Token không hợp lệ' });
  req.user = user;
  next();
}

// ── Health check ──
app.get('/', (req, res) => {
  res.json({ status: 'ok', message: 'GenzTech API Server', version: '1.0.0', time: new Date().toISOString() });
});

app.get('/health', (req, res) => {
  res.json({ status: 'ok' });
});

// ══════════════════════════════════════════════
// AUTH ROUTES
// ══════════════════════════════════════════════

// Register
app.post('/api/auth/register', (req, res) => {
  const { username, email, password } = req.body;
  if (!username || !password) return res.status(400).json({ error: 'Thiếu thông tin đăng ký' });
  const id = `user_${Date.now()}`;
  const user = { id, username, email: email || '', password, fbToken: null, createdAt: new Date().toISOString() };
  users.set(id, user);
  const token = generateToken(user);
  res.json({ success: true, token, user: { id, username, email: user.email } });
});

// Login
app.post('/api/auth/login', (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) return res.status(400).json({ error: 'Thiếu username hoặc password' });
  // Find user by username
  let found = null;
  for (const [, u] of users) {
    if ((u.username === username || u.email === username) && u.password === password) {
      found = u; break;
    }
  }
  if (!found) {
    // Auto-create account for demo
    const id = `user_${Date.now()}`;
    found = { id, username, email: '', password, fbToken: null, createdAt: new Date().toISOString() };
    users.set(id, found);
  }
  const token = generateToken(found);
  res.json({ success: true, token, user: { id: found.id, username: found.username, email: found.email } });
});

// Get current user
app.get('/api/auth/me', authMiddleware, (req, res) => {
  res.json({ id: req.user.id, username: req.user.username, email: req.user.email });
});

// ══════════════════════════════════════════════
// FACEBOOK AUTH ROUTES
// ══════════════════════════════════════════════

// Facebook OAuth URL
app.get('/api/facebook/oauth/url', (req, res) => {
  const appId = process.env.FB_APP_ID || '';
  const redirectUri = process.env.FB_REDIRECT_URI || `${req.protocol}://${req.get('host')}/api/facebook/oauth/callback`;
  const scope = 'ads_management,ads_read,business_management,pages_read_engagement';
  if (!appId) return res.status(500).json({ error: 'FB_APP_ID chưa được cấu hình' });
  const url = `https://www.facebook.com/v25.0/dialog/oauth?client_id=${appId}&redirect_uri=${encodeURIComponent(redirectUri)}&scope=${scope}&response_type=code`;
  res.json({ url });
});

// Facebook status
app.get('/api/facebook/status', authMiddleware, (req, res) => {
  const user = users.get(req.user.id);
  const connected = !!(user && user.fbToken);
  res.json({ connected, token: connected ? user.fbToken.substring(0, 10) + '...' : null });
});

// Facebook sync (save token)
app.post('/api/facebook/sync', authMiddleware, (req, res) => {
  const { token } = req.body;
  if (!token) return res.status(400).json({ error: 'Thiếu token' });
  const user = users.get(req.user.id);
  if (user) { user.fbToken = token; users.set(req.user.id, user); }
  res.json({ success: true });
});

// Facebook disconnect
app.post('/api/facebook/disconnect', authMiddleware, (req, res) => {
  const user = users.get(req.user.id);
  if (user) { user.fbToken = null; users.set(req.user.id, user); }
  res.json({ success: true });
});

// ══════════════════════════════════════════════
// FACEBOOK PROXY ROUTES (for JWT users)
// ══════════════════════════════════════════════

function getFbToken(req) {
  const user = users.get(req.user?.id);
  return user?.fbToken || process.env.FB_DEFAULT_TOKEN || null;
}

// Get my ad accounts
app.get('/api/facebook/proxy/my-ad-accounts', authMiddleware, async (req, res) => {
  try {
    const token = getFbToken(req);
    if (!token) return res.status(400).json({ error: 'Chưa kết nối Facebook. Vui lòng nhập Access Token.' });
    const datePreset = req.query.date_preset || 'last_30d';
    const r = await axios.get(`${FB_GRAPH}/me/adaccounts`, {
      params: { fields: 'id,name,account_status,balance,currency,amount_spent,timezone_name,country', limit: 50, access_token: token }
    });
    res.json({ accounts: r.data.data || [] });
  } catch (e) {
    const msg = e.response?.data?.error?.message || e.message;
    res.status(500).json({ error: msg });
  }
});

// Get ad account details (campaigns)
app.get('/api/facebook/proxy/ad-account/:accountId', authMiddleware, async (req, res) => {
  try {
    const token = getFbToken(req);
    if (!token) return res.status(400).json({ error: 'Chưa kết nối Facebook' });
    const { accountId } = req.params;
    const datePreset = req.query.date_preset || 'last_30d';
    const r = await axios.get(`${FB_GRAPH}/${accountId}/campaigns`, {
      params: { fields: 'id,name,status,objective,daily_budget,lifetime_budget', limit: 100, access_token: token }
    });
    // Get insights for each campaign
    const campaigns = r.data.data || [];
    await Promise.all(campaigns.map(async c => {
      try {
        const ins = await axios.get(`${FB_GRAPH}/${c.id}/insights`, {
          params: { fields: 'spend,impressions,clicks,ctr,cpc', date_preset: datePreset, access_token: token }
        });
        c.insights = { data: ins.data.data || [] };
      } catch (e) { c.insights = { data: [] }; }
    }));
    res.json({ campaigns });
  } catch (e) {
    const msg = e.response?.data?.error?.message || e.message;
    res.status(500).json({ error: msg });
  }
});

// Generic Facebook proxy
app.get('/api/facebook/proxy/*', authMiddleware, async (req, res) => {
  try {
    const token = getFbToken(req);
    if (!token) return res.status(400).json({ error: 'Chưa kết nối Facebook' });
    const path = req.params[0];
    const r = await axios.get(`${FB_GRAPH}/${path}`, {
      params: { ...req.query, access_token: token }
    });
    res.json(r.data);
  } catch (e) {
    const msg = e.response?.data?.error?.message || e.message;
    res.status(500).json({ error: msg });
  }
});

// Pause campaigns
app.post('/api/facebook/proxy/pause-campaigns', authMiddleware, async (req, res) => {
  try {
    const token = getFbToken(req);
    if (!token) return res.status(400).json({ error: 'Chưa kết nối Facebook' });
    const { accountId, level, reason } = req.body;
    // Get campaigns and pause them
    const r = await axios.get(`${FB_GRAPH}/${accountId}/campaigns`, {
      params: { fields: 'id,name,status', limit: 100, access_token: token }
    });
    const campaigns = (r.data.data || []).filter(c => c.status === 'ACTIVE');
    await Promise.all(campaigns.map(c =>
      axios.post(`${FB_GRAPH}/${c.id}`, null, { params: { status: 'PAUSED', access_token: token } }).catch(() => {})
    ));
    res.json({ success: true, paused: campaigns.length, reason });
  } catch (e) {
    const msg = e.response?.data?.error?.message || e.message;
    res.status(500).json({ error: msg });
  }
});

// ══════════════════════════════════════════════
// FACEBOOK POST / MEDIA ROUTES
// ══════════════════════════════════════════════

app.post('/api/facebook/post', authMiddleware, async (req, res) => {
  try {
    const token = getFbToken(req);
    if (!token) return res.status(400).json({ error: 'Chưa kết nối Facebook' });
    const { pageId, message, mediaUrl, scheduledTime } = req.body;
    const params = { message, access_token: token };
    if (scheduledTime) { params.scheduled_publish_time = scheduledTime; params.published = false; }
    const endpoint = mediaUrl ? `${FB_GRAPH}/${pageId}/photos` : `${FB_GRAPH}/${pageId}/feed`;
    if (mediaUrl) params.url = mediaUrl;
    const r = await axios.post(endpoint, null, { params });
    res.json({ success: true, postId: r.data.id });
  } catch (e) {
    const msg = e.response?.data?.error?.message || e.message;
    res.status(500).json({ error: msg });
  }
});

// Schedule post
app.post('/api/posts/schedule', authMiddleware, async (req, res) => {
  try {
    const token = getFbToken(req);
    if (!token) return res.status(400).json({ error: 'Chưa kết nối Facebook' });
    const { pageId, message, mediaUrl, scheduledTime } = req.body;
    const params = { message, access_token: token, scheduled_publish_time: scheduledTime, published: false };
    const endpoint = mediaUrl ? `${FB_GRAPH}/${pageId}/photos` : `${FB_GRAPH}/${pageId}/feed`;
    if (mediaUrl) params.url = mediaUrl;
    const r = await axios.post(endpoint, null, { params });
    res.json({ success: true, postId: r.data.id });
  } catch (e) {
    const msg = e.response?.data?.error?.message || e.message;
    res.status(500).json({ error: msg });
  }
});

// Facebook check cookie
app.post('/api/facebook/check-cookie', async (req, res) => {
  try {
    const { cookie } = req.body;
    if (!cookie) return res.status(400).json({ error: 'Thiếu cookie' });
    // Basic validation
    const hasCookie = cookie.includes('c_user') || cookie.includes('xs=');
    res.json({ valid: hasCookie, message: hasCookie ? 'Cookie hợp lệ' : 'Cookie không hợp lệ hoặc đã hết hạn' });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Facebook find ID
app.get('/api/facebook/proxy/find-id', async (req, res) => {
  try {
    const { query } = req.query;
    if (!query) return res.status(400).json({ error: 'Thiếu query' });
    const token = process.env.FB_DEFAULT_TOKEN || '';
    if (!token) return res.status(400).json({ error: 'Chưa cấu hình FB token' });
    const r = await axios.get(`${FB_GRAPH}/`, { params: { id: query, access_token: token } });
    res.json(r.data);
  } catch (e) {
    const msg = e.response?.data?.error?.message || e.message;
    res.status(500).json({ error: msg });
  }
});

// Ad library proxy
app.get('/api/facebook/proxy/ad-library', async (req, res) => {
  try {
    const token = process.env.FB_DEFAULT_TOKEN || req.query.token || '';
    if (!token) return res.status(400).json({ error: 'Thiếu token' });
    const params = { ...req.query, access_token: token };
    delete params.token;
    const r = await axios.get(`${FB_GRAPH}/ads_archive`, { params });
    res.json(r.data);
  } catch (e) {
    const msg = e.response?.data?.error?.message || e.message;
    res.status(500).json({ error: msg });
  }
});

// AI generate
app.post('/api/ai/generate', async (req, res) => {
  try {
    const { prompt, type } = req.body;
    if (!prompt) return res.status(400).json({ error: 'Thiếu prompt' });
    const openaiKey = process.env.OPENAI_API_KEY;
    if (!openaiKey) return res.status(500).json({ error: 'Chưa cấu hình OpenAI API key' });
    const r = await axios.post('https://api.openai.com/v1/chat/completions', {
      model: 'gpt-4o-mini',
      messages: [{ role: 'user', content: prompt }],
      max_tokens: 1000
    }, { headers: { Authorization: `Bearer ${openaiKey}`, 'Content-Type': 'application/json' } });
    res.json({ result: r.data.choices[0].message.content });
  } catch (e) {
    const msg = e.response?.data?.error?.message || e.message;
    res.status(500).json({ error: msg });
  }
});

// ── 404 handler ──
app.use((req, res) => {
  res.status(404).json({ error: `Route không tồn tại: ${req.method} ${req.path}` });
});

// ── Start server ──
app.listen(PORT, () => {
  console.log(`✅ GenzTech Backend running on port ${PORT}`);
  console.log(`📡 Environment: ${process.env.NODE_ENV || 'development'}`);
});
