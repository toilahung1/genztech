const express = require('express');
const axios = require('axios');
const multer = require('multer');
const { authMiddleware, prisma } = require('../middleware/auth');

const router = express.Router();
const FB_GRAPH = 'https://graph.facebook.com/v25.0';
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 50 * 1024 * 1024 } }); // 50MB

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

    // Exchange code for token
    const tokenRes = await axios.get(`${FB_GRAPH}/oauth/access_token`, {
      params: { client_id: appId, client_secret: appSecret, redirect_uri: redirectUri, code }
    });
    const shortToken = tokenRes.data.access_token;

    // Exchange for long-lived token
    const longRes = await axios.get(`${FB_GRAPH}/oauth/access_token`, {
      params: { grant_type: 'fb_exchange_token', client_id: appId, client_secret: appSecret, fb_exchange_token: shortToken }
    });
    const longToken = longRes.data.access_token;
    const expiresIn = longRes.data.expires_in || 5184000; // 60 days default
    const expiresAt = new Date(Date.now() + expiresIn * 1000);

    // Get user info
    const meRes = await axios.get(`${FB_GRAPH}/me`, { params: { fields: 'id,name,picture', access_token: longToken } });
    const fbUser = meRes.data;

    // Get pages
    const pagesRes = await axios.get(`${FB_GRAPH}/me/accounts`, { params: { access_token: longToken } });
    const pages = pagesRes.data.data || [];

    // Store in session (redirect with token info to frontend)
    // Since this is a popup flow, we close the popup and notify parent
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
    const user = await prisma.user.findUnique({
      where: { id: req.user.id },
      select: { fbToken: true, fbTokenExp: true, fbUserId: true, fbPages: true }
    });
    if (!user || !user.fbToken) return res.json({ connected: false });

    const now = new Date();
    const exp = user.fbTokenExp ? new Date(user.fbTokenExp) : null;
    const daysLeft = exp ? Math.max(0, Math.floor((exp - now) / (1000 * 60 * 60 * 24))) : null;

    // Verify token is still valid
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
      // Token invalid
      await prisma.user.update({ where: { id: req.user.id }, data: { fbToken: null } });
      res.json({ connected: false, error: 'Token Facebook đã hết hạn' });
    }
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/facebook/sync — Save FB token from client
router.post('/sync', authMiddleware, async (req, res) => {
  try {
    const { token, fbUser, pages, expiresAt } = req.body;
    if (!token) return res.status(400).json({ error: 'Thiếu token' });

    await prisma.user.update({
      where: { id: req.user.id },
      data: {
        fbToken: token,
        fbUserId: fbUser?.id || null,
        fbTokenExp: expiresAt ? new Date(expiresAt) : new Date(Date.now() + 60 * 24 * 60 * 60 * 1000), // 60 days
        fbPages: pages || []
      }
    });
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/facebook/disconnect
const disconnectHandler = async (req, res) => {
  try {
    await prisma.user.update({
      where: { id: req.user.id },
      data: { fbToken: null, fbUserId: null, fbTokenExp: null, fbPages: null }
    });
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
};
router.post('/disconnect', authMiddleware, disconnectHandler);
router.delete('/disconnect', authMiddleware, disconnectHandler);

// POST /api/facebook/refresh — Extend token
router.post('/refresh', authMiddleware, async (req, res) => {
  try {
    const user = await prisma.user.findUnique({ where: { id: req.user.id }, select: { fbToken: true } });
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

    await prisma.user.update({ where: { id: req.user.id }, data: { fbToken: newToken, fbTokenExp: expiresAt } });
    res.json({ success: true, expiresAt: expiresAt.toISOString(), daysLeft: Math.floor(expiresIn / 86400) });
  } catch (e) {
    const msg = e.response?.data?.error?.message || e.message;
    res.status(500).json({ error: msg });
  }
});

// POST /api/facebook/upload-media?pageId=xxx
router.post('/upload-media', authMiddleware, upload.single('file'), async (req, res) => {
  try {
    const user = await prisma.user.findUnique({ where: { id: req.user.id }, select: { fbToken: true, fbPages: true } });
    if (!user?.fbToken) return res.status(400).json({ error: 'Chưa kết nối Facebook' });

    const pageId = req.query.pageId;
    if (!pageId) return res.status(400).json({ error: 'Thiếu pageId' });

    // Get page access token
    const pages = Array.isArray(user.fbPages) ? user.fbPages : [];
    const page = pages.find(p => p.id === pageId);
    const pageToken = page?.access_token || user.fbToken;

    if (!req.file) return res.status(400).json({ error: 'Thiếu file' });

    // Upload to Facebook
    const FormData = require('form-data');
    const form = new FormData();
    form.append('source', req.file.buffer, { filename: req.file.originalname, contentType: req.file.mimetype });
    form.append('access_token', pageToken);
    form.append('published', 'false'); // Upload but don't publish yet

    const uploadRes = await axios.post(`${FB_GRAPH}/${pageId}/photos`, form, {
      headers: form.getHeaders()
    });
    res.json({ success: true, mediaId: uploadRes.data.id, url: `https://www.facebook.com/photo?fbid=${uploadRes.data.id}` });
  } catch (e) {
    const msg = e.response?.data?.error?.message || e.message;
    res.status(500).json({ error: msg });
  }
});

// POST /api/facebook/post — Đăng bài ngay
router.post('/post', authMiddleware, async (req, res) => {
  try {
    const user = await prisma.user.findUnique({ where: { id: req.user.id }, select: { fbToken: true, fbPages: true } });
    if (!user?.fbToken) return res.status(400).json({ error: 'Chưa kết nối Facebook' });

    const { pageId, content, mediaUrls, mediaIds } = req.body;
    if (!pageId) return res.status(400).json({ error: 'Thiếu pageId' });

    const pages = Array.isArray(user.fbPages) ? user.fbPages : [];
    const page = pages.find(p => p.id === pageId);
    const pageToken = page?.access_token || user.fbToken;

    let postId;
    if (mediaIds && mediaIds.length > 0) {
      // Post with multiple photos
      const attachedMedia = mediaIds.map(id => ({ media_fbid: id }));
      const r = await axios.post(`${FB_GRAPH}/${pageId}/feed`, null, {
        params: { message: content || '', attached_media: JSON.stringify(attachedMedia), access_token: pageToken }
      });
      postId = r.data.id;
    } else if (mediaUrls && mediaUrls.length === 1) {
      // Single photo from URL
      const r = await axios.post(`${FB_GRAPH}/${pageId}/photos`, null, {
        params: { url: mediaUrls[0], caption: content || '', access_token: pageToken }
      });
      postId = r.data.id;
    } else {
      // Text only
      const r = await axios.post(`${FB_GRAPH}/${pageId}/feed`, null, {
        params: { message: content || '', access_token: pageToken }
      });
      postId = r.data.id;
    }

    // Save to DB
    await prisma.post.create({
      data: { content: content || '', mediaUrls: mediaUrls || [], status: 'posted', postFbId: postId, authorId: req.user.id, pageId, postedAt: new Date() }
    });

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

module.exports = router;
