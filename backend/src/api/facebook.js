const express = require('express');
const axios = require('axios');
const multer = require('multer');
const { authMiddleware } = require('../middleware/auth');
const { users } = require('./auth'); // in-memory user store

const router = express.Router();
const FB_GRAPH = 'https://graph.facebook.com/v25.0';
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 50 * 1024 * 1024 } });

function getUserStore(userId) {
  for (const u of users.values()) {
    if (u.id === userId) return u;
  }
  return null;
}

// GET /api/facebook/oauth/url
router.get('/oauth/url', (req, res) => {
  const appId = process.env.FB_APP_ID;
  if (!appId) return res.status(500).json({ error: 'FB_APP_ID chưa được cấu hình trên server' });
  const redirectUri = process.env.FB_REDIRECT_URI || `${req.protocol}://${req.get('host')}/api/facebook/oauth/callback`;
  const scope = 'pages_manage_posts,pages_read_engagement,pages_show_list,ads_management,ads_read,business_management';
  const url = `https://www.facebook.com/v25.0/dialog/oauth?client_id=${appId}&redirect_uri=${encodeURIComponent(redirectUri)}&scope=${scope}&response_type=code&state=${Date.now()}`;
  res.json({ url });
});

// GET /api/facebook/oauth/callback
router.get('/oauth/callback', async (req, res) => {
  try {
    const { code, error } = req.query;
    if (error) return res.redirect(`/?fb_error=${encodeURIComponent(error)}`);
    if (!code) return res.status(400).json({ error: 'Thiếu authorization code' });

    const appId = process.env.FB_APP_ID;
    const appSecret = process.env.FB_APP_SECRET;
    const redirectUri = process.env.FB_REDIRECT_URI || `${req.protocol}://${req.get('host')}/api/facebook/oauth/callback`;

    const tokenRes = await axios.get(`${FB_GRAPH}/oauth/access_token`, {
      params: { client_id: appId, client_secret: appSecret, redirect_uri: redirectUri, code }
    });
    const shortToken = tokenRes.data.access_token;

    const longRes = await axios.get(`${FB_GRAPH}/oauth/access_token`, {
      params: { grant_type: 'fb_exchange_token', client_id: appId, client_secret: appSecret, fb_exchange_token: shortToken }
    });
    const longToken = longRes.data.access_token;
    const expiresIn = longRes.data.expires_in || 5184000;
    const expiresAt = new Date(Date.now() + expiresIn * 1000);

    const meRes = await axios.get(`${FB_GRAPH}/me`, { params: { fields: 'id,name,picture', access_token: longToken } });
    const fbUser = meRes.data;

    const pagesRes = await axios.get(`${FB_GRAPH}/me/accounts`, { params: { access_token: longToken } });
    const pages = pagesRes.data.data || [];

    res.send(`
      <script>
        window.opener && window.opener.postMessage({
          type: 'FB_OAUTH_SUCCESS',
          token: '${longToken}',
          fbUser: ${JSON.stringify(fbUser)},
          pages: ${JSON.stringify(pages)},
          expiresAt: '${expiresAt.toISOString()}'
        }, '*');
        window.close();
      </script>
      <p>Kết nối thành công! Cửa sổ này sẽ tự đóng...</p>
    `);
  } catch (e) {
    console.error('[FB/OAuth/Callback]', e.message);
    res.send(`<script>window.opener && window.opener.postMessage({type:'FB_OAUTH_ERROR',error:'${e.message}'},'*'); window.close();</script>`);
  }
});

// GET /api/facebook/status
router.get('/status', authMiddleware, async (req, res) => {
  try {
    const user = getUserStore(req.user.id);
    if (!user || !user.fbToken) return res.json({ connected: false });

    const now = new Date();
    const exp = user.fbTokenExp ? new Date(user.fbTokenExp) : null;
    const daysLeft = exp ? Math.max(0, Math.floor((exp - now) / (1000 * 60 * 60 * 24))) : null;

    try {
      const meRes = await axios.get(`${FB_GRAPH}/me`, { params: { fields: 'id,name,picture', access_token: user.fbToken }, timeout: 5000 });
      res.json({
        connected: true,
        fbUser: meRes.data,
        pages: user.fbPages || [],
        expiresAt: exp ? exp.toISOString() : null,
        daysLeft
      });
    } catch (fbErr) {
      user.fbToken = null;
      res.json({ connected: false, error: 'Token Facebook đã hết hạn' });
    }
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/facebook/sync
router.post('/sync', authMiddleware, async (req, res) => {
  try {
    const { token, fbUser, pages, expiresAt } = req.body;
    if (!token) return res.status(400).json({ error: 'Thiếu token' });

    const user = getUserStore(req.user.id);
    if (user) {
      user.fbToken = token;
      user.fbUserId = fbUser?.id || null;
      user.fbTokenExp = expiresAt ? new Date(expiresAt) : new Date(Date.now() + 60 * 24 * 60 * 60 * 1000);
      user.fbPages = pages || [];
    }
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST/DELETE /api/facebook/disconnect
const disconnectHandler = (req, res) => {
  try {
    const user = getUserStore(req.user.id);
    if (user) {
      user.fbToken = null;
      user.fbUserId = null;
      user.fbTokenExp = null;
      user.fbPages = null;
    }
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
};
router.post('/disconnect', authMiddleware, disconnectHandler);
router.delete('/disconnect', authMiddleware, disconnectHandler);

// POST /api/facebook/refresh
router.post('/refresh', authMiddleware, async (req, res) => {
  try {
    const user = getUserStore(req.user.id);
    if (!user?.fbToken) return res.status(400).json({ error: 'Chưa kết nối Facebook' });

    const appId = process.env.FB_APP_ID;
    const appSecret = process.env.FB_APP_SECRET;
    if (!appId || !appSecret) return res.status(500).json({ error: 'Chưa cấu hình FB App credentials' });

    const r = await axios.get(`${FB_GRAPH}/oauth/access_token`, {
      params: { grant_type: 'fb_exchange_token', client_id: appId, client_secret: appSecret, fb_exchange_token: user.fbToken }
    });
    const newToken = r.data.access_token;
    const expiresIn = r.data.expires_in || 5184000;
    const expiresAt = new Date(Date.now() + expiresIn * 1000);

    user.fbToken = newToken;
    user.fbTokenExp = expiresAt;

    res.json({ success: true, expiresAt: expiresAt.toISOString(), daysLeft: Math.floor(expiresIn / 86400) });
  } catch (e) {
    const msg = e.response?.data?.error?.message || e.message;
    res.status(500).json({ error: msg });
  }
});

// POST /api/facebook/upload-media
router.post('/upload-media', authMiddleware, upload.single('file'), async (req, res) => {
  try {
    const user = getUserStore(req.user.id);
    if (!user?.fbToken) return res.status(400).json({ error: 'Chưa kết nối Facebook' });

    const pageId = req.query.pageId;
    if (!pageId) return res.status(400).json({ error: 'Thiếu pageId' });

    const pages = Array.isArray(user.fbPages) ? user.fbPages : [];
    const page = pages.find(p => p.id === pageId);
    const pageToken = page?.access_token || user.fbToken;

    if (!req.file) return res.status(400).json({ error: 'Thiếu file' });

    const FormData = require('form-data');
    const form = new FormData();
    form.append('source', req.file.buffer, { filename: req.file.originalname, contentType: req.file.mimetype });
    form.append('access_token', pageToken);
    form.append('published', 'false');

    const uploadRes = await axios.post(`${FB_GRAPH}/${pageId}/photos`, form, { headers: form.getHeaders() });
    res.json({ success: true, mediaId: uploadRes.data.id, url: `https://www.facebook.com/photo?fbid=${uploadRes.data.id}` });
  } catch (e) {
    const msg = e.response?.data?.error?.message || e.message;
    res.status(500).json({ error: msg });
  }
});

// POST /api/facebook/post
router.post('/post', authMiddleware, async (req, res) => {
  try {
    const user = getUserStore(req.user.id);
    if (!user?.fbToken) return res.status(400).json({ error: 'Chưa kết nối Facebook' });

    const { pageId, content, mediaUrls, mediaIds } = req.body;
    if (!pageId) return res.status(400).json({ error: 'Thiếu pageId' });

    const pages = Array.isArray(user.fbPages) ? user.fbPages : [];
    const page = pages.find(p => p.id === pageId);
    const pageToken = page?.access_token || user.fbToken;

    let postId;
    if (mediaIds && mediaIds.length > 0) {
      const attachedMedia = mediaIds.map(id => ({ media_fbid: id }));
      const r = await axios.post(`${FB_GRAPH}/${pageId}/feed`, null, {
        params: { message: content || '', attached_media: JSON.stringify(attachedMedia), access_token: pageToken }
      });
      postId = r.data.id;
    } else if (mediaUrls && mediaUrls.length === 1) {
      const r = await axios.post(`${FB_GRAPH}/${pageId}/photos`, null, {
        params: { url: mediaUrls[0], caption: content || '', access_token: pageToken }
      });
      postId = r.data.id;
    } else {
      const r = await axios.post(`${FB_GRAPH}/${pageId}/feed`, null, {
        params: { message: content || '', access_token: pageToken }
      });
      postId = r.data.id;
    }

    res.json({ success: true, postId });
  } catch (e) {
    const msg = e.response?.data?.error?.message || e.message;
    res.status(500).json({ error: msg });
  }
});

// POST /api/facebook/check-cookie
router.post('/check-cookie', async (req, res) => {
  try {
    const { cookie } = req.body;
    if (!cookie) return res.status(400).json({ error: 'Thiếu cookie' });
    const valid = cookie.includes('c_user=') && cookie.includes('xs=');
    res.json({ valid, message: valid ? 'Cookie hợp lệ' : 'Cookie không hợp lệ hoặc thiếu trường c_user/xs' });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// GET /api/facebook/scrape-id?url=...
// Scrape Facebook ID từ URL public, không cần access token
router.get('/scrape-id', async (req, res) => {
  try {
    const { url } = req.query;
    if (!url) return res.status(400).json({ error: 'Thiếu tham số url' });

    const raw = url.trim();
    const fullUrl = raw.startsWith('http') ? raw : 'https://www.facebook.com/' + raw;

    // Bước 1: Thử trích xuất ID số trực tiếp từ URL
    try {
      const u = new URL(fullUrl);
      const path = u.pathname.replace(/\/$/, '');
      const parts = path.split('/').filter(Boolean);

      // profile.php?id=XXXXXXX
      const qid = u.searchParams.get('id');
      if (qid && /^\d+$/.test(qid)) {
        return res.json({ id: qid, name: null, type: 'unknown', source: 'url_extract', url: fullUrl });
      }
      // /groups/XXXXXXX (số)
      if (parts[0] === 'groups' && parts[1] && /^\d+$/.test(parts[1])) {
        return res.json({ id: parts[1], name: null, type: 'group', source: 'url_extract', url: fullUrl });
      }
      // /pages/Name/XXXXXXX (số)
      if (parts[0] === 'pages' && parts.length >= 3) {
        const last = parts[parts.length - 1];
        if (/^\d+$/.test(last)) {
          return res.json({ id: last, name: parts[1]?.replace(/-/g,' ') || null, type: 'page', source: 'url_extract', url: fullUrl });
        }
      }
      // /<số>
      if (parts.length === 1 && /^\d+$/.test(parts[0])) {
        return res.json({ id: parts[0], name: null, type: 'unknown', source: 'url_extract', url: fullUrl });
      }
    } catch(_) {}

    // Bước 2: Scrape HTML của trang Facebook để tìm entity_id / pageID
    const headers = {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'vi-VN,vi;q=0.9,en;q=0.8',
      'Accept-Encoding': 'gzip, deflate, br',
      'Cache-Control': 'no-cache',
      'sec-fetch-dest': 'document',
      'sec-fetch-mode': 'navigate',
      'sec-fetch-site': 'none'
    };

    const resp = await axios.get(fullUrl, { headers, timeout: 10000, maxRedirects: 5 });
    const html = resp.data;

    // Pattern matching để tìm Facebook ID trong HTML
    const patterns = [
      /"entity_id":"(\d+)"/,
      /"pageID":"(\d+)"/,
      /"userID":"(\d+)"/,
      /"actorID":"(\d+)"/,
      /"profileID":"(\d+)"/,
      /"ownerID":"(\d+)"/,
      /"groupID":"(\d+)"/,
      /\"id\":\"(\d{5,})\"/,
      /content=\"https:\/\/www\.facebook\.com\/(\d+)\"/,
      /\"profile_id\":(\d+)/,
      /\"page_id\":\"(\d+)\"/,
      /__bbox.*?"id":"(\d{10,})"/s
    ];

    let foundId = null;
    for (const pat of patterns) {
      const m = html.match(pat);
      if (m && m[1] && m[1].length >= 5) {
        foundId = m[1];
        break;
      }
    }

    // Tìm tên trang
    let name = null;
    const titleMatch = html.match(/<title>([^<]+)<\/title>/);
    if (titleMatch) {
      name = titleMatch[1].replace(' | Facebook', '').replace(' - Facebook', '').trim();
    }

    // Xác định loại
    let type = 'profile';
    if (fullUrl.includes('/groups/')) type = 'group';
    else if (fullUrl.includes('/pages/') || html.includes('"page_id"')) type = 'page';

    if (!foundId) {
      return res.status(404).json({ error: 'Không tìm thấy ID. Trang có thể đã đặt chế độ riêng tư hoặc yêu cầu đăng nhập.' });
    }

    res.json({ id: foundId, name, type, source: 'html_scrape', url: fullUrl });
  } catch (e) {
    if (e.response?.status === 404) return res.status(404).json({ error: 'Không tìm thấy trang Facebook này' });
    if (e.response?.status === 403) return res.status(403).json({ error: 'Facebook chặn truy cập. Thử lại sau.' });
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
