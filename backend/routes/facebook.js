const express = require('express');
const multer  = require('multer');
const fs      = require('fs');

// Multer — lưu ảnh tạm vào /tmp/gz_uploads
const upload = multer({
  dest: '/tmp/gz_uploads/',
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const ok = /image\/(jpeg|png|gif|webp)/.test(file.mimetype);
    cb(ok ? null : new Error('Chỉ chấp nhận file ảnh'), ok);
  },
});
const auth    = require('../middleware/auth');
const { tokenStmt, pageStmt, logStmt } = require('../database');
const { fullConnect, inspectToken, refreshLongToken, getPages, postToPage } = require('../tokenManager');

const router = express.Router();
router.use(auth);

// ============================================================
//  POST /api/facebook/connect
//  Nhận short-lived token → đổi long-lived → lưu page tokens
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
//  Kiểm tra trạng thái kết nối và thông tin token hiện tại
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
//  Gia hạn token thủ công (user nhấn nút refresh)
// ============================================================
router.post('/refresh', async (req, res) => {
  const fbToken = tokenStmt.findByUser.get(req.userId);
  if (!fbToken) return res.status(404).json({ error: 'Chưa kết nối Facebook' });

  try {
    const { longToken, expiresAt, success, error } = await refreshLongToken(fbToken.long_token);
    if (!success) throw new Error(error);

    tokenStmt.updateLong.run(longToken, expiresAt, req.userId, fbToken.fb_user_id);

    // Cập nhật lại page tokens
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
//  Kiểm tra chi tiết token (debug)
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
//  Lấy danh sách Pages đã lưu
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
//  POST /api/facebook/post
//  Đăng bài ngay lập tức qua server (token bảo mật ở backend)
// ============================================================
router.post('/post', async (req, res) => {
  const { pageId, content, linkUrl, imageUrl, photoId } = req.body;
  if (!pageId || !content) return res.status(400).json({ error: 'pageId và content là bắt buộc' });

  const pageRow = pageStmt.findByPageId.get(req.userId, pageId);
  if (!pageRow) return res.status(404).json({ error: 'Không tìm thấy Page hoặc bạn không có quyền' });

  try {
    const result = await postToPage(pageId, pageRow.page_token, content, linkUrl, imageUrl, photoId);
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
    const msg = err.response?.data?.error?.message || err.message;
    const { histStmt } = require('../database');
    histStmt.create.run({
      user_id:    req.userId,
      page_id:    pageId,
      page_name:  pageRow.page_name,
      content,
      fb_post_id: null,
      status:     'failed',
      error_msg:  msg,
    });
    res.status(400).json({ error: 'Đăng bài thất bại: ' + msg });
  }
});

// ============================================================
//  POST /api/facebook/upload-image
//  Upload ảnh từ frontend → gửi thẳng lên Facebook Graph API
//  Trả về { imageUrl } để dùng khi đăng bài
// ============================================================
router.post('/upload-image', upload.single('image'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Không có file ảnh' });

  const { pageId } = req.body;
  if (!pageId) {
    fs.unlinkSync(req.file.path);
    return res.status(400).json({ error: 'pageId là bắt buộc' });
  }

  const pageRow = pageStmt.findByPageId.get(req.userId, pageId);
  if (!pageRow) {
    fs.unlinkSync(req.file.path);
    return res.status(404).json({ error: 'Không tìm thấy Page' });
  }

  try {
    const axios = require('axios');
    const FormData = require('form-data');
    const form = new FormData();
    form.append('source', fs.createReadStream(req.file.path), {
      filename: req.file.originalname || 'image.jpg',
      contentType: req.file.mimetype,
    });
    form.append('published', 'false'); // Đăng ảnh không public — chỉ dùng để attach vào bài viết
    form.append('access_token', pageRow.page_token);

    const fbRes = await axios.post(
      `https://graph.facebook.com/v19.0/${pageId}/photos`,
      form,
      { headers: form.getHeaders() }
    );
    fs.unlinkSync(req.file.path);
    // Trả về photo_id để attach vào bài feed
    res.json({ success: true, photoId: fbRes.data.id });
  } catch (err) {
    try { fs.unlinkSync(req.file.path); } catch {}
    const msg = err.response?.data?.error?.message || err.message;
    res.status(400).json({ error: 'Upload ảnh thất bại: ' + msg });
  }
});

// ============================================================
//  DELETE /api/facebook/disconnect
//  Ngắt kết nối Facebook
// ============================================================
router.delete('/disconnect', (req, res) => {
  const fbToken = tokenStmt.findByUser.get(req.userId);
  if (fbToken) {
    tokenStmt.delete.run(req.userId, fbToken.fb_user_id);
    logStmt.create.run(req.userId, fbToken.fb_user_id, 'revoke', 1, 'User disconnected');
  }
  res.json({ success: true, message: 'Đã ngắt kết nối Facebook' });
});

module.exports = router;
