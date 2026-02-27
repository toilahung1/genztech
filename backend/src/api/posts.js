const express = require('express');
const { authMiddleware } = require('../middleware/auth');

const router = express.Router();

// In-memory posts store: Map<userId, Post[]>
const postsStore = new Map();
let postIdCounter = 1;

function getUserPosts(userId) {
  if (!postsStore.has(userId)) postsStore.set(userId, []);
  return postsStore.get(userId);
}

// GET /api/posts
router.get('/', authMiddleware, (req, res) => {
  try {
    const posts = getUserPosts(req.user.id).slice().reverse().slice(0, 100);
    res.json({ posts });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/posts/schedule
router.post('/schedule', authMiddleware, (req, res) => {
  try {
    const { pageId, pageName, content, mediaUrls, scheduledAt, repeatType } = req.body;
    if (!pageId) return res.status(400).json({ error: 'Thiếu pageId' });
    if (!scheduledAt) return res.status(400).json({ error: 'Thiếu thời gian lên lịch' });

    const schedTime = new Date(scheduledAt);
    if (schedTime <= new Date()) return res.status(400).json({ error: 'Thời gian lên lịch phải ở tương lai' });

    const post = {
      id: String(postIdCounter++),
      content: content || '',
      mediaUrls: mediaUrls || [],
      status: 'pending',
      scheduledAt: schedTime.toISOString(),
      repeatType: repeatType || 'once',
      authorId: req.user.id,
      pageId,
      pageName: pageName || '',
      createdAt: new Date().toISOString()
    };

    getUserPosts(req.user.id).push(post);
    res.status(201).json({ success: true, post });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// DELETE /api/posts/:id
router.delete('/:id', authMiddleware, (req, res) => {
  try {
    const posts = getUserPosts(req.user.id);
    const idx = posts.findIndex(p => p.id === req.params.id);
    if (idx === -1) return res.status(404).json({ error: 'Không tìm thấy bài đăng' });
    if (posts[idx].status === 'posted') return res.status(400).json({ error: 'Không thể xóa bài đã đăng' });
    posts.splice(idx, 1);
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
module.exports.postsStore = postsStore;
