const express = require('express');
const auth    = require('../middleware/auth');
const { schedStmt, histStmt } = require('../database');

const router = express.Router();
router.use(auth);

// ============================================================
//  GET /api/posts/scheduled
//  Lấy danh sách bài đã lên lịch
// ============================================================
router.get('/scheduled', (req, res) => {
  const posts = schedStmt.findByUser.all(req.userId);
  res.json({ success: true, posts });
});

// ============================================================
//  GET /api/posts/scheduled/pending
//  Chỉ lấy bài đang chờ đăng
// ============================================================
router.get('/scheduled/pending', (req, res) => {
  const posts = schedStmt.findPendingByUser.all(req.userId);
  res.json({ success: true, posts, count: posts.length });
});

// ============================================================
//  POST /api/posts/schedule
//  Lên lịch đăng bài mới
// ============================================================
router.post('/schedule', (req, res) => {
  const { pageId, pageName, content, imageUrl, linkUrl, postType, scheduledAt, repeatType } = req.body;

  if (!pageId || !content || !scheduledAt) {
    return res.status(400).json({ error: 'pageId, content và scheduledAt là bắt buộc' });
  }

  const at = new Date(scheduledAt);
  if (at <= new Date()) {
    return res.status(400).json({ error: 'Thời gian đăng phải sau thời điểm hiện tại' });
  }

  try {
    const info = schedStmt.create.run({
      user_id:      req.userId,
      page_id:      pageId,
      page_name:    pageName || '',
      content,
      image_url:    imageUrl || null,
      link_url:     linkUrl  || null,
      post_type:    postType || 'feed',
      scheduled_at: at.toISOString(),
      repeat_type:  repeatType || 'none',
    });

    res.json({
      success: true,
      postId:  info.lastInsertRowid,
      message: `Đã lên lịch đăng vào ${at.toLocaleString('vi-VN')}`,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ============================================================
//  DELETE /api/posts/scheduled/:id
//  Hủy bài đã lên lịch
// ============================================================
router.delete('/scheduled/:id', (req, res) => {
  const info = schedStmt.cancel.run(parseInt(req.params.id), req.userId);
  if (info.changes === 0) return res.status(404).json({ error: 'Không tìm thấy bài viết' });
  res.json({ success: true, message: 'Đã hủy lịch đăng' });
});

// ============================================================
//  GET /api/posts/history
//  Lấy lịch sử đăng bài
// ============================================================
router.get('/history', (req, res) => {
  const { status } = req.query;
  const posts = status
    ? histStmt.findByStatus.all(req.userId, status)
    : histStmt.findByUser.all(req.userId);
  res.json({ success: true, posts });
});

// ============================================================
//  GET /api/posts/stats
//  Thống kê tổng quan
// ============================================================
router.get('/stats', (req, res) => {
  const { db } = require('../database');

  const total     = db.prepare('SELECT COUNT(*) as n FROM post_history WHERE user_id = ?').get(req.userId).n;
  const posted    = db.prepare("SELECT COUNT(*) as n FROM post_history WHERE user_id = ? AND status = 'posted'").get(req.userId).n;
  const failed    = db.prepare("SELECT COUNT(*) as n FROM post_history WHERE user_id = ? AND status = 'failed'").get(req.userId).n;
  const pending   = db.prepare("SELECT COUNT(*) as n FROM scheduled_posts WHERE user_id = ? AND status = 'pending'").get(req.userId).n;
  const today     = db.prepare("SELECT COUNT(*) as n FROM post_history WHERE user_id = ? AND posted_at >= date('now')").get(req.userId).n;
  const thisWeek  = db.prepare("SELECT COUNT(*) as n FROM post_history WHERE user_id = ? AND posted_at >= date('now', '-7 days')").get(req.userId).n;

  res.json({ success: true, stats: { total, posted, failed, pending, today, thisWeek } });
});

module.exports = router;
