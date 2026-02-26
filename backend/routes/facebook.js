const express  = require('express');
const multer   = require('multer');
const fs       = require('fs');
const axios    = require('axios');
const FormData = require('form-data');

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
router.use(auth);

// ============================================================
//  POST /api/facebook/connect
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
//  Upload nhiều ảnh HOẶC 1 video → Facebook Graph API
//  Body: multipart/form-data
//    - files[]: ảnh (tối đa 10) HOẶC 1 video
//    - pageId: string
//  Response: { photoIds: [...] } hoặc { videoId, videoUrl }
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

  // Kiểm tra có video không
  const videoFile = files.find(f => f.mimetype.startsWith('video/'));
  const imageFiles = files.filter(f => f.mimetype.startsWith('image/'));

  try {
    // ── TRƯỜNG HỢP 1: Upload VIDEO ──
    if (videoFile) {
      // Chỉ cho phép 1 video tại một thời điểm
      if (files.length > 1) {
        files.forEach(f => { try { fs.unlinkSync(f.path); } catch {} });
        return res.status(400).json({ error: 'Chỉ được upload 1 video tại một lần. Không thể kết hợp video với ảnh.' });
      }

      const form = new FormData();
      form.append('source', fs.createReadStream(videoFile.path), {
        filename: videoFile.originalname || 'video.mp4',
        contentType: videoFile.mimetype,
      });
      form.append('description', ''); // Sẽ được cập nhật khi đăng bài
      form.append('published', 'false');
      form.append('access_token', pageRow.page_token);

      const fbRes = await axios.post(
        `https://graph.facebook.com/v19.0/${pageId}/videos`,
        form,
        {
          headers: form.getHeaders(),
          maxContentLength: Infinity,
          maxBodyLength: Infinity,
          timeout: 120000, // 2 phút cho video lớn
        }
      );

      try { fs.unlinkSync(videoFile.path); } catch {}
      return res.json({
        success:   true,
        mediaType: 'video',
        videoId:   fbRes.data.id,
      });
    }

    // ── TRƯỜNG HỢP 2: Upload NHIỀU ẢNH ──
    const photoIds = [];
    for (const imgFile of imageFiles) {
      const form = new FormData();
      form.append('source', fs.createReadStream(imgFile.path), {
        filename: imgFile.originalname || 'image.jpg',
        contentType: imgFile.mimetype,
      });
      form.append('published', 'false');
      form.append('access_token', pageRow.page_token);

      const fbRes = await axios.post(
        `https://graph.facebook.com/v19.0/${pageId}/photos`,
        form,
        { headers: form.getHeaders() }
      );
      photoIds.push(fbRes.data.id);
      try { fs.unlinkSync(imgFile.path); } catch {}
    }

    return res.json({
      success:   true,
      mediaType: 'photos',
      photoIds,
    });

  } catch (err) {
    files.forEach(f => { try { fs.unlinkSync(f.path); } catch {} });
    const fbErr = err.response?.data?.error;
    const msg = fbErr?.message || err.message;
    const code = fbErr?.code;
    const subcode = fbErr?.error_subcode;
    const type = fbErr?.type;
    // Phân loại lỗi Facebook để hiển thị rõ hơn
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
    res.status(400).json({
      error: userMsg,
      fbCode: code,
      fbSubcode: subcode,
      fbType: type,
      fbMessage: msg,
    });
  }
});

// ============================================================
//  POST /api/facebook/post
//  Đăng bài ngay lập tức
//  Body: { pageId, content, linkUrl?, photoIds?: [...], videoId? }
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
    // Phân loại lỗi Facebook
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
//  Lịch sử refresh token của user (tối đa 20 mục gần nhất)
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
