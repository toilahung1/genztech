const express = require('express');
const axios = require('axios');
const { authMiddleware, prisma } = require('../middleware/auth');

const router = express.Router();
const FB_GRAPH = 'https://graph.facebook.com/v25.0';

// GET /api/posts — Lấy danh sách bài đã lên lịch
router.get('/', authMiddleware, async (req, res) => {
  try {
    const posts = await prisma.post.findMany({
      where: { authorId: req.user.id },
      orderBy: { createdAt: 'desc' },
      take: 100
    });
    res.json({ posts });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/posts/schedule — Lên lịch bài đăng
router.post('/schedule', authMiddleware, async (req, res) => {
  try {
    const { pageId, pageName, content, mediaUrls, scheduledAt, repeatType } = req.body;
    if (!pageId) return res.status(400).json({ error: 'Thiếu pageId' });
    if (!scheduledAt) return res.status(400).json({ error: 'Thiếu thời gian lên lịch' });

    const schedTime = new Date(scheduledAt);
    if (schedTime <= new Date()) return res.status(400).json({ error: 'Thời gian lên lịch phải ở tương lai' });

    const post = await prisma.post.create({
      data: {
        content: content || '',
        mediaUrls: mediaUrls || [],
        status: 'pending',
        scheduledAt: schedTime,
        repeatType: repeatType || 'once',
        authorId: req.user.id,
        pageId,
        pageName: pageName || ''
      }
    });
    res.status(201).json({ success: true, post });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// DELETE /api/posts/:id — Xóa bài đã lên lịch
router.delete('/:id', authMiddleware, async (req, res) => {
  try {
    const post = await prisma.post.findFirst({ where: { id: req.params.id, authorId: req.user.id } });
    if (!post) return res.status(404).json({ error: 'Không tìm thấy bài đăng' });
    if (post.status === 'posted') return res.status(400).json({ error: 'Không thể xóa bài đã đăng' });

    await prisma.post.delete({ where: { id: req.params.id } });
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
