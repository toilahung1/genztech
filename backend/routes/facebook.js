/**
 * GenZTech — Facebook Routes (PostgreSQL async version)
 */
const express    = require('express');
const axios      = require('axios');
const FormData   = require('form-data');
const multer     = require('multer');
const fs         = require('fs');
const crypto     = require('crypto');
const auth       = require('../middleware/auth');
const { tokenStmt, pageStmt, histStmt, logStmt } = require('../database');

const router   = express.Router();
const FB_GRAPH = 'https://graph.facebook.com/v19.0';
const APP_ID     = process.env.FB_APP_ID;
const APP_SECRET = process.env.FB_APP_SECRET;
const BACKEND_URL  = process.env.BACKEND_URL  || 'https://genztech-production.up.railway.app';
const FRONTEND_URL = process.env.FRONTEND_URL || 'https://toilahung1.github.io';

// Lưu OAuth states tạm thời (in-memory, hết hạn 10 phút)
const oauthStates = new Map();

// Multer — lưu file tạm vào /tmp
const upload = multer({
  dest: '/tmp/genztech-uploads/',
  limits: { fileSize: 50 * 1024 * 1024 },
});

// ============================================================
//  Helper: fullConnect — exchange token, lưu DB
// ============================================================
async function fullConnect(userId, shortToken) {
  // 1. Exchange short → long-lived token
  const longRes = await axios.get(`${FB_GRAPH}/oauth/access_token`, {
    params: {
      grant_type:        'fb_exchange_token',
      client_id:         APP_ID,
      client_secret:     APP_SECRET,
      fb_exchange_token: shortToken,
    },
  });
  const longToken = longRes.data.access_token;
  const expiresIn = longRes.data.expires_in || 5184000; // 60 ngày
  const expiresAt = new Date(Date.now() + expiresIn * 1000).toISOString();

  // 2. Lấy thông tin user
  const meRes = await axios.get(`${FB_GRAPH}/me`, {
    params: { access_token: longToken, fields: 'id,name,picture' },
  });
  const fbUser = meRes.data;

  // 3. Lưu token vào DB
  const tokenRow = await tokenStmt.upsert({
    user_id:           userId,
    fb_user_id:        fbUser.id,
    fb_user_name:      fbUser.name,
    fb_user_picture:   fbUser.picture?.data?.url || null,
    short_token:       shortToken,
    long_token:        longToken,
    long_token_expires: expiresAt,
  });

  // 4. Lấy danh sách Pages
  const pagesRes = await axios.get(`${FB_GRAPH}/me/accounts`, {
    params: { access_token: longToken, fields: 'id,name,access_token,picture,category' },
  });
  const pages = pagesRes.data.data || [];

  // 5. Lưu pages vào DB
  for (const page of pages) {
    await pageStmt.upsert({
      user_id:      userId,
      fb_token_id:  tokenRow.id,
      page_id:      page.id,
      page_name:    page.name,
      page_token:   page.access_token,
      page_picture: page.picture?.data?.url || null,
      category:     page.category || null,
    });
  }

  // 6. Ghi log
  await logStmt.create(userId, fbUser.id, 'connect', true, `Connected, expires: ${expiresAt}`);

  return { fbUser, longToken, expiresAt, pages };
}

// ============================================================
//  Helper: postToPage
// ============================================================
async function postToPage(pageId, pageToken, content, linkUrl, photoIds, videoId) {
  if (videoId) {
    const res = await axios.post(`${FB_GRAPH}/${pageId}/feed`, {
      message:      content,
      attached_media: [{ media_fbid: videoId }],
      access_token: pageToken,
    });
    return res.data;
  }
  if (photoIds && photoIds.length > 0) {
    const attached = photoIds.map(id => ({ media_fbid: id }));
    const res = await axios.post(`${FB_GRAPH}/${pageId}/feed`, {
      message:        content,
      attached_media: attached,
      access_token:   pageToken,
    });
    return res.data;
  }
  const params = { message: content, access_token: pageToken };
  if (linkUrl) params.link = linkUrl;
  const res = await axios.post(`${FB_GRAPH}/${pageId}/feed`, params);
  return res.data;
}

// ============================================================
//  GET /api/facebook/oauth/url
// ============================================================
router.get('/oauth/url', auth, (req, res) => {
  if (!APP_ID) return res.status(500).json({ error: 'FB_APP_ID chưa được cấu hình trên server' });
  const state = crypto.randomBytes(16).toString('hex');
  oauthStates.set(state, { userId: req.userId, expires: Date.now() + 10 * 60 * 1000 });
  const redirectUri = `${BACKEND_URL}/api/facebook/oauth/callback`;
  const scope = 'pages_show_list,pages_manage_posts,pages_read_engagement,pages_manage_metadata,public_profile';
  const url = `https://www.facebook.com/v19.0/dialog/oauth?` +
    `client_id=${APP_ID}` +
    `&redirect_uri=${encodeURIComponent(redirectUri)}` +
    `&scope=${encodeURIComponent(scope)}` +
    `&state=${state}` +
    `&response_type=code`;
  res.json({ success: true, url, state });
});

// ============================================================
//  GET /api/facebook/oauth/callback
// ============================================================
router.get('/oauth/callback', async (req, res) => {
  const { code, state, error: fbError, error_description } = req.query;
  if (fbError) {
    const msg = error_description || fbError;
    return res.redirect(`${FRONTEND_URL}/genztech/auto-post.html?fb_error=${encodeURIComponent(msg)}`);
  }
  const stateData = oauthStates.get(state);
  if (!stateData || stateData.expires < Date.now()) {
    oauthStates.delete(state);
    return res.redirect(`${FRONTEND_URL}/genztech/auto-post.html?fb_error=${encodeURIComponent('Phiên đăng nhập hết hạn. Vui lòng thử lại.')}`);
  }
  oauthStates.delete(state);
  const { userId } = stateData;
  const redirectUri = `${BACKEND_URL}/api/facebook/oauth/callback`;
  try {
    const tokenRes = await axios.get(`${FB_GRAPH}/oauth/access_token`, {
      params: { client_id: APP_ID, client_secret: APP_SECRET, redirect_uri: redirectUri, code },
    });
    const shortToken = tokenRes.data.access_token;
    const result = await fullConnect(userId, shortToken);
    const successMsg = encodeURIComponent(`Kết nối thành công! ${result.pages.length} Page. Token hết hạn: ${new Date(result.expiresAt).toLocaleDateString('vi-VN')}`);
    return res.redirect(`${FRONTEND_URL}/genztech/auto-post.html?fb_success=1&fb_msg=${successMsg}`);
  } catch (err) {
    const msg = err.response?.data?.error?.message || err.message;
    console.error('[OAuth Callback Error]', msg);
    return res.redirect(`${FRONTEND_URL}/genztech/auto-post.html?fb_error=${encodeURIComponent('Kết nối thất bại: ' + msg)}`);
  }
});

// Áp dụng auth JWT cho tất cả routes còn lại
router.use(auth);

// ============================================================
//  POST /api/facebook/connect (backward compatible)
// ============================================================
router.post('/connect', async (req, res) => {
  const { token } = req.body;
  if (!token) return res.status(400).json({ error: 'Token là bắt buộc' });
  try {
    const result = await fullConnect(req.userId, token);
    res.json({
      success:   true,
      fbUser:    { id: result.fbUser.id, name: result.fbUser.name, picture: result.fbUser.picture?.data?.url },
      expiresAt: result.expiresAt,
      pages:     result.pages,
      message:   `Kết nối thành công! Token hết hạn: ${new Date(result.expiresAt).toLocaleDateString('vi-VN')}`,
    });
  } catch (err) {
    const msg = err.response?.data?.error?.message || err.message;
    res.status(400).json({ error: 'Kết nối thất bại: ' + msg });
  }
});

// ============================================================
//  GET /api/facebook/status
// ============================================================
router.get('/status', async (req, res) => {
  try {
    const fbToken = await tokenStmt.findByUser(req.userId);
    if (!fbToken) return res.json({ connected: false });
    const pages = await pageStmt.findByUser(req.userId);
    const expiresAt = fbToken.long_token_expires;
    const daysLeft = expiresAt
      ? Math.ceil((new Date(expiresAt) - Date.now()) / (1000 * 3600 * 24))
      : null;
    res.json({
      connected: true,
      fbUser: {
        id:      fbToken.fb_user_id,
        name:    fbToken.fb_user_name,
        picture: fbToken.fb_user_picture,
      },
      expiresAt,
      daysLeft,
      warning: daysLeft !== null && daysLeft <= 15,
      pages: pages.map(p => ({ id: p.page_id, name: p.page_name, picture: p.page_picture })),
    });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ============================================================
//  POST /api/facebook/refresh
// ============================================================
router.post('/refresh', async (req, res) => {
  try {
    const fbToken = await tokenStmt.findByUser(req.userId);
    if (!fbToken) return res.status(404).json({ error: 'Chưa kết nối Facebook' });
    const longRes = await axios.get(`${FB_GRAPH}/oauth/access_token`, {
      params: {
        grant_type:        'fb_exchange_token',
        client_id:         APP_ID,
        client_secret:     APP_SECRET,
        fb_exchange_token: fbToken.long_token,
      },
    });
    const longToken = longRes.data.access_token;
    const expiresIn = longRes.data.expires_in || 5184000;
    const expiresAt = new Date(Date.now() + expiresIn * 1000).toISOString();
    await tokenStmt.updateLong(longToken, expiresAt, req.userId, fbToken.fb_user_id);
    // Cập nhật page tokens
    const pagesRes = await axios.get(`${FB_GRAPH}/me/accounts`, {
      params: { access_token: longToken, fields: 'id,name,access_token,picture,category' },
    });
    for (const page of (pagesRes.data.data || [])) {
      await pageStmt.upsert({
        user_id:      req.userId,
        fb_token_id:  fbToken.id,
        page_id:      page.id,
        page_name:    page.name,
        page_token:   page.access_token,
        page_picture: page.picture?.data?.url || null,
        category:     page.category || null,
      });
    }
    await logStmt.create(req.userId, fbToken.fb_user_id, 'refresh', true, `Manual refresh, new expiry: ${expiresAt}`);
    const daysLeft = Math.ceil((new Date(expiresAt) - Date.now()) / (1000 * 3600 * 24));
    res.json({ success: true, expiresAt, daysLeft, message: `Gia hạn thành công! Token hết hạn sau ${daysLeft} ngày.` });
  } catch (err) {
    const fbToken2 = await tokenStmt.findByUser(req.userId).catch(() => null);
    if (fbToken2) await logStmt.create(req.userId, fbToken2.fb_user_id, 'refresh', false, err.message).catch(() => {});
    const msg = err.response?.data?.error?.message || err.message;
    res.status(400).json({ error: 'Gia hạn thất bại: ' + msg });
  }
});

// ============================================================
//  GET /api/facebook/pages
// ============================================================
router.get('/pages', async (req, res) => {
  try {
    const pages = await pageStmt.findByUser(req.userId);
    res.json({ success: true, pages: pages.map(p => ({ id: p.page_id, name: p.page_name, picture: p.page_picture, category: p.category })) });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ============================================================
//  POST /api/facebook/upload-media
// ============================================================
router.post('/upload-media', upload.array('files', 10), async (req, res) => {
  const pageId = req.query?.pageId || req.body?.pageId;
  if (!pageId) return res.status(400).json({ error: 'pageId là bắt buộc' });
  const files = req.files || [];
  if (files.length === 0) return res.status(400).json({ error: 'Không có file nào được upload' });
  try {
    const pageRow = await pageStmt.findByPageId(req.userId, pageId);
    if (!pageRow) {
      files.forEach(f => { try { fs.unlinkSync(f.path); } catch {} });
      return res.status(404).json({ error: 'Không tìm thấy Page hoặc bạn không có quyền' });
    }
    // Video
    const videoFiles = files.filter(f => f.mimetype.startsWith('video/'));
    if (videoFiles.length > 0) {
      const videoFile = videoFiles[0];
      const form = new FormData();
      form.append('source', fs.createReadStream(videoFile.path), {
        filename: videoFile.originalname || 'video.mp4',
        contentType: videoFile.mimetype,
      });
      form.append('published', 'false');
      form.append('access_token', pageRow.page_token);
      const fbRes = await axios.post(`${FB_GRAPH}/${pageId}/videos`, form, {
        headers: form.getHeaders(), maxContentLength: Infinity, maxBodyLength: Infinity, timeout: 120000,
      });
      files.forEach(f => { try { fs.unlinkSync(f.path); } catch {} });
      return res.json({ success: true, mediaType: 'video', videoId: fbRes.data.id });
    }
    // Photos
    const imageFiles = files.filter(f => f.mimetype.startsWith('image/'));
    const photoIds = [];
    for (const imgFile of imageFiles) {
      const form = new FormData();
      form.append('source', fs.createReadStream(imgFile.path), {
        filename: imgFile.originalname || 'image.jpg',
        contentType: imgFile.mimetype,
      });
      form.append('published', 'false');
      form.append('access_token', pageRow.page_token);
      const fbRes = await axios.post(`${FB_GRAPH}/${pageId}/photos`, form, { headers: form.getHeaders() });
      photoIds.push(fbRes.data.id);
      try { fs.unlinkSync(imgFile.path); } catch {}
    }
    return res.json({ success: true, mediaType: 'photos', photoIds });
  } catch (err) {
    files.forEach(f => { try { fs.unlinkSync(f.path); } catch {} });
    const fbErr = err.response?.data?.error;
    const msg = fbErr?.message || err.message;
    const code = fbErr?.code;
    const subcode = fbErr?.error_subcode;
    const type = fbErr?.type;
    let userMsg = 'Upload media thất bại: ' + msg;
    if (code === 32 || code === 613 || subcode === 1487742) {
      userMsg = 'Facebook đang giới hạn tần suất gọi API (rate limit). Vui lòng chờ 15-60 phút rồi thử lại.';
    } else if (code === 190) {
      userMsg = 'Access Token đã hết hạn hoặc bị thu hồi. Vui lòng kết nối lại Facebook.';
    } else if (code === 200 || code === 10 || code === 100) {
      userMsg = 'Không có quyền upload media. Kiểm tra lại quyền pages_manage_posts và pages_read_engagement.';
    } else if (code === 368 || code === 21) {
      userMsg = 'Tài khoản Facebook bị tạm khóa hoặc bị cấm gọi API. Vui lòng đợi vài ngày rồi thử lại.';
    }
    console.error(`[Upload] FB Error code=${code} subcode=${subcode} type=${type}: ${msg}`);
    res.status(400).json({ error: userMsg, fbCode: code, fbSubcode: subcode, fbType: type, fbMessage: msg });
  }
});

// ============================================================
//  POST /api/facebook/post
// ============================================================
router.post('/post', async (req, res) => {
  const { pageId, content, linkUrl, photoIds, videoId } = req.body;
  if (!pageId || !content) return res.status(400).json({ error: 'pageId và content là bắt buộc' });
  try {
    const pageRow = await pageStmt.findByPageId(req.userId, pageId);
    if (!pageRow) return res.status(404).json({ error: 'Không tìm thấy Page hoặc bạn không có quyền' });
    const result = await postToPage(pageId, pageRow.page_token, content, linkUrl, photoIds, videoId);
    await histStmt.create({
      user_id:    req.userId,
      page_id:    pageId,
      page_name:  pageRow.page_name,
      content,
      fb_post_id: result.id || null,
      status:     'posted',
      error_msg:  null,
    });
    res.json({ success: true, postId: result.id, message: 'Đăng bài thành công!' });
  } catch (err) {
    const fbErr = err.response?.data?.error;
    const msg = fbErr?.message || err.message;
    const code = fbErr?.code;
    const subcode = fbErr?.error_subcode;
    let userMsg = 'Đăng bài thất bại: ' + msg;
    if (code === 32 || code === 613) {
      userMsg = 'Facebook đang giới hạn tần suất gọi API. Vui lòng chờ 15-60 phút rồi thử lại.';
    } else if (code === 190) {
      userMsg = 'Access Token đã hết hạn. Vui lòng kết nối lại Facebook.';
    } else if (code === 368 || code === 21) {
      userMsg = 'Tài khoản Facebook bị tạm khóa. Vui lòng đợi vài ngày rồi thử lại.';
    }
    const pageRow2 = await pageStmt.findByPageId(req.userId, pageId).catch(() => null);
    await histStmt.create({
      user_id:    req.userId,
      page_id:    pageId,
      page_name:  pageRow2?.page_name || '',
      content,
      fb_post_id: null,
      status:     'failed',
      error_msg:  `[${code}] ${msg}`,
    }).catch(() => {});
    console.error(`[Post] FB Error code=${code} subcode=${subcode}: ${msg}`);
    res.status(400).json({ error: userMsg, fbCode: code, fbMessage: msg });
  }
});

// ============================================================
//  DELETE /api/facebook/disconnect
// ============================================================
router.delete('/disconnect', async (req, res) => {
  try {
    const fbToken = await tokenStmt.findByUser(req.userId);
    if (fbToken) {
      await tokenStmt.delete(req.userId, fbToken.fb_user_id);
      await logStmt.create(req.userId, fbToken.fb_user_id, 'revoke', true, 'User disconnected');
    }
    res.json({ success: true, message: 'Đã ngắt kết nối Facebook' });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ============================================================
//  GET /api/facebook/token-log
// ============================================================
router.get('/token-log', async (req, res) => {
  try {
    const logs = await logStmt.findByUser(req.userId, 20);
    res.json({ success: true, logs });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
