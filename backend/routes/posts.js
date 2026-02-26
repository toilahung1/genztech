const express = require('express');
const auth    = require('../middleware/auth');
const { schedStmt, histStmt, pool } = require('../database');
const router = express.Router();
router.use(auth);

// GET /api/posts/scheduled
router.get('/scheduled', async (req, res) => {
  try {
    const posts = await schedStmt.findByUser(req.userId);
    res.json({ success: true, posts });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// GET /api/posts/scheduled/pending
router.get('/scheduled/pending', async (req, res) => {
  try {
    const posts = await schedStmt.findPendingByUser(req.userId);
    res.json({ success: true, posts, count: posts.length });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// POST /api/posts/schedule
router.post('/schedule', async (req, res) => {
  const { pageId, pageName, content, imageUrl, linkUrl, postType, scheduledAt, repeatType } = req.body;
  if (!pageId || !content || !scheduledAt) {
    return res.status(400).json({ error: 'pageId, content và scheduledAt là bắt buộc' });
  }
  const at = new Date(scheduledAt);
  if (at <= new Date()) {
    return res.status(400).json({ error: 'Thời gian đăng phải sau thời điểm hiện tại' });
  }
  try {
    const post = await schedStmt.create({
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
      postId:  post.id,
      message: `Đã lên lịch đăng vào ${at.toLocaleString('vi-VN')}`,
    });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// DELETE /api/posts/scheduled/:id
router.delete('/scheduled/:id', async (req, res) => {
  try {
    await schedStmt.cancel(parseInt(req.params.id), req.userId);
    res.json({ success: true, message: 'Đã hủy lịch đăng' });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// GET /api/posts/history
router.get('/history', async (req, res) => {
  try {
    const { status } = req.query;
    const posts = status
      ? await histStmt.findByStatus(req.userId, status)
      : await histStmt.findByUser(req.userId);
    res.json({ success: true, posts });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// GET /api/posts/stats
router.get('/stats', async (req, res) => {
  try {
    const uid = req.userId;
    const [total, posted, failed, pending, today, thisWeek] = await Promise.all([
      pool.query('SELECT COUNT(*) as n FROM post_history WHERE user_id=$1', [uid]).then(r => parseInt(r.rows[0].n)),
      pool.query("SELECT COUNT(*) as n FROM post_history WHERE user_id=$1 AND status='posted'", [uid]).then(r => parseInt(r.rows[0].n)),
      pool.query("SELECT COUNT(*) as n FROM post_history WHERE user_id=$1 AND status='failed'", [uid]).then(r => parseInt(r.rows[0].n)),
      pool.query("SELECT COUNT(*) as n FROM scheduled_posts WHERE user_id=$1 AND status='pending'", [uid]).then(r => parseInt(r.rows[0].n)),
      pool.query("SELECT COUNT(*) as n FROM post_history WHERE user_id=$1 AND posted_at >= CURRENT_DATE", [uid]).then(r => parseInt(r.rows[0].n)),
      pool.query("SELECT COUNT(*) as n FROM post_history WHERE user_id=$1 AND posted_at >= NOW() - INTERVAL '7 days'", [uid]).then(r => parseInt(r.rows[0].n)),
    ]);
    res.json({ success: true, stats: { total, posted, failed, pending, today, thisWeek } });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
