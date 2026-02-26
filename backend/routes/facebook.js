const express  = require('express');
const multer   = require('multer');
const fs       = require('fs');
const axios    = require('axios');
const FormData = require('form-data');
const crypto   = require('crypto');

// ============================================================
//  Multer — hỗ trợ cả ảnh và video, tối đa 10 file
// ============================================================
const uploadMedia = multer({
  dest: '/tmp/gz_uploads/',
  limits: { fileSize: 200 * 1024 * 1024 }, // 200MB cho video
  fileFilter: (req, file, cb) => {
    const ok = /^(image\/(jpeg|png|gif|webp)|video\/(mp4|quicktime|x-msvideo|x-ms-wmv|3gpp|webm))$/.test(file.mimetype);
    cb(ok ? null : new Error('Chỉ chấp nhận ảnh (JPG/PNG/GIF/WEBP) hoặc video (MP4/MOV/AVI/WMV)'), ok);
  },
});

const auth    = require('../middleware/auth');
const { tokenStmt, pageStmt, logStmt } = require('../database');
const { fullConnect, inspectToken, refreshLongToken, getPages, postToPage } = require('../tokenManager');

const router = express.Router();

const FB_GRAPH    = 'https://graph.facebook.com/v19.0';
const APP_ID      = process.env.FB_APP_ID;
const APP_SECRET  = process.env.FB_APP_SECRET;
const BACKEND_URL = process.env.BACKEND_URL || 'https://genztech-production.up.railway.app';
const FRONTEND_URL = process.env.FRONTEND_URL || 'https://toilahung1.github.io';

// Lưu tạm state OAuth (trong production nên dùng Redis, ở đây dùng Map trong memory)
const oauthStates = new Map();

// ============================================================
//  GET /api/facebook/oauth/url
//  Tạo URL đăng nhập Facebook OAuth — KHÔNG cần auth JWT
//  Query: ?jwt=<token> (để biết user nào đang kết nối)
// ============================================================
router.get('/oauth/url', require('../middleware/auth'), (req, res) => {
  if (!APP_ID) return res.status(500).json({ error: 'FB_APP_ID chưa được cấu hình trên server' });

  // Tạo state ngẫu nhiên để chống CSRF
  const state = crypto.randomBytes(16).toString('hex');
  // Lưu state kèm userId, hết hạn sau 10 phút
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
//  Facebook redirect về đây sau khi user đăng nhập
//  KHÔNG cần auth JWT — dùng state để xác định user
// ============================================================
router.get('/oauth/callback', async (req, res) => {
  const { code, state, error: fbError, error_description } = req.query;

  // Xử lý lỗi từ Facebook (user từ chối cấp quyền)
  if (fbError) {
    const msg = error_description || fbError;
    return res.redirect(`${FRONTEND_URL}/genztech/auto-post.html?fb_error=${encodeURIComponent(msg)}`);
  }

  // Kiểm tra state hợp lệ
  const stateData = oauthStates.get(state);
  if (!stateData || stateData.expires < Date.now()) {
    oauthStates.delete(state);
    return res.redirect(`${FRONTEND_URL}/genztech/auto-post.html?fb_error=${encodeURIComponent('Phiên đăng nhập hết hạn. Vui lòng thử lại.')}`);
  }
  oauthStates.delete(state); // Dùng 1 lần

  const { userId } = stateData;
  const redirectUri = `${BACKEND_URL}/api/facebook/oauth/callback`;

  try {
    // 1. Đổi code → short-lived access token
    const tokenRes = await axios.get(`${FB_GRAPH}/oauth/access_token`, {
      params: {
        client_id:     APP_ID,
        client_secret: APP_SECRET,
        redirect_uri:  redirectUri,
        code,
      },
    });
    const shortToken = tokenRes.data.access_token;

    // 2. fullConnect: exchange → long-lived, lấy pages, lưu DB
    const result = await fullConnect(userId, shortToken);

    // 3. Redirect về frontend với thông báo thành công
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
//  POST /api/facebook/connect
//  Kết nối thủ công bằng token (vẫn giữ để backward compatible)
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
router.get('/status', (req, res) => {
  const fbToken = tokenStmt.findByUser.get(req.userId);
  if (!fbToken) return res.json({ connected: false });
  const pages = pageStmt.findByUser.all(req.userId);
  const expiresAt = fbToken.long_token_expires;
  const daysLeft = expiresAt
    ? Math.ceil((new Date(expiresAt) - Date.now()) / (1000 * 3600 * 24))
    : null;
  res.json({
    connected:  true,
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
});

// ============================================================
//  POST /api/facebook/refresh
// ============================================================
router.post('/refresh', async (req, res) => {
  const fbToken = tokenStmt.findByUser.get(req.userId);
  if (!fbToken) return res.status(404).json({ error: 'Chưa kết nối Facebook' });
  try {
    const { longToken, expiresAt, success, error } = await refreshLongToken(fbToken.long_token);
    if (!success) throw new Error(error);
    tokenStmt.updateLong.run(longToken, expiresAt, req.userId, fbToken.fb_user_id);
    const pages = await getPages(longToken);
    for (const page of pages) {
      pageStmt.upsert.run({
        user_id:      req.userId,
        fb_token_id:  fbToken.id,
        page_id:      page.id,
        page_name:    page.name,
        page_token:   page.access_token,
        page_picture: page.picture?.data?.url || null,
        category:     page.category || null,
      });
    }
    logStmt.create.run(req.userId, fbToken.fb_user_id, 'refresh', 1, `Manual refresh, new expiry: ${expiresAt}`);
    res.json({
      success:   true,
      expiresAt,
      daysLeft:  Math.ceil((new Date(expiresAt) - Date.now()) / (1000 * 3600 * 24)),
      message:   `Token đã được gia hạn đến ${new Date(expiresAt).toLocaleDateString('vi-VN')}`,
    });
  } catch (err) {
    logStmt.create.run(req.userId, fbToken.fb_user_id, 'refresh', 0, err.message);
    res.status(400).json({ error: 'Gia hạn thất bại: ' + err.message });
  }
});

// ============================================================
//  POST /api/facebook/inspect
// ============================================================
router.post('/inspect', async (req, res) => {
  const { token } = req.body;
  if (!token) return res.status(400).json({ error: 'Token là bắt buộc' });
  try {
    const info = await inspectToken(token);
    res.json({ success: true, info });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// ============================================================
//  GET /api/facebook/pages
// ============================================================
router.get('/pages', (req, res) => {
  const pages = pageStmt.findByUser.all(req.userId);
  res.json({
    success: true,
    pages: pages.map(p => ({
      id:      p.page_id,
      name:    p.page_name,
      picture: p.page_picture,
    })),
  });
});

// ============================================================
//  POST /api/facebook/upload-media
// ============================================================
router.post('/upload-media', uploadMedia.array('files', 10), async (req, res) => {
  const files = req.files;
  if (!files || files.length === 0) return res.status(400).json({ error: 'Không có file nào được gửi lên' });

  const pageId = req.body?.pageId || req.query?.pageId;
  if (!pageId) {
    files.forEach(f => { try { fs.unlinkSync(f.path); } catch {} });
    return res.status(400).json({ error: 'pageId là bắt buộc' });
  }

  const pageRow = pageStmt.findByPageId.get(req.userId, pageId);
  if (!pageRow) {
    files.forEach(f => { try { fs.unlinkSync(f.path); } catch {} });
    return res.status(404).json({ error: 'Không tìm thấy Page' });
  }

  const videoFile = files.find(f => f.mimetype.startsWith('video/'));
  const imageFiles = files.filter(f => f.mimetype.startsWith('image/'));

  try {
    if (videoFile) {
      if (files.length > 1) {
        files.forEach(f => { try { fs.unlinkSync(f.path); } catch {} });
        return res.status(400).json({ error: 'Chỉ được upload 1 video tại một lần.' });
      }
      const form = new FormData();
      form.append('source', fs.createReadStream(videoFile.path), {
        filename: videoFile.originalname || 'video.mp4',
        contentType: videoFile.mimetype,
      });
      form.append('description', '');
      form.append('published', 'false');
      form.append('access_token', pageRow.page_token);
      const fbRes = await axios.post(
        `${FB_GRAPH}/${pageId}/videos`,
        form,
        { headers: form.getHeaders(), maxContentLength: Infinity, maxBodyLength: Infinity, timeout: 120000 }
      );
      try { fs.unlinkSync(videoFile.path); } catch {}
      return res.json({ success: true, mediaType: 'video', videoId: fbRes.data.id });
    }

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

  const pageRow = pageStmt.findByPageId.get(req.userId, pageId);
  if (!pageRow) return res.status(404).json({ error: 'Không tìm thấy Page hoặc bạn không có quyền' });

  try {
    const result = await postToPage(pageId, pageRow.page_token, content, linkUrl, photoIds, videoId);
    const { histStmt } = require('../database');
    histStmt.create.run({
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
    const { histStmt } = require('../database');
    histStmt.create.run({
      user_id:    req.userId,
      page_id:    pageId,
      page_name:  pageRow.page_name,
      content,
      fb_post_id: null,
      status:     'failed',
      error_msg:  `[${code}] ${msg}`,
    });
    console.error(`[Post] FB Error code=${code} subcode=${subcode}: ${msg}`);
    res.status(400).json({ error: userMsg, fbCode: code, fbMessage: msg });
  }
});

// ============================================================
//  DELETE /api/facebook/disconnect
// ============================================================
router.delete('/disconnect', (req, res) => {
  const fbToken = tokenStmt.findByUser.get(req.userId);
  if (fbToken) {
    tokenStmt.delete.run(req.userId, fbToken.fb_user_id);
    logStmt.create.run(req.userId, fbToken.fb_user_id, 'revoke', 1, 'User disconnected');
  }
  res.json({ success: true, message: 'Đã ngắt kết nối Facebook' });
});

// ============================================================
//  GET /api/facebook/token-log
// ============================================================
router.get('/token-log', (req, res) => {
  const { db } = require('../database');
  const logs = db.prepare(`
    SELECT action, success, message, created_at
    FROM token_refresh_log
    WHERE user_id = ?
    ORDER BY created_at DESC
    LIMIT 20
  `).all(req.userId);
  res.json({ success: true, logs });
});

module.exports = router;
