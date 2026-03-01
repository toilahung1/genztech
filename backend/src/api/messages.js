/**
 * GenzTech — Messages API
 *
 * POST /api/messages/fetch          — Trigger fetch tin nhắn từ FB cho user hiện tại
 * GET  /api/messages/conversations  — Lấy danh sách conversations
 * GET  /api/messages/conversations/:id/messages — Lấy messages trong 1 conversation
 * GET  /api/messages/stats          — Thống kê tổng số tin nhắn
 */
const express = require('express');
const axios   = require('axios');
const { PrismaClient } = require('@prisma/client');
const { authMiddleware } = require('../middleware/auth');

const router = express.Router();
const prisma = new PrismaClient();
const FB_GRAPH = 'https://graph.facebook.com/v19.0';

// ── Helper ────────────────────────────────────────────────────
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function fbGet(path, params = {}, retries = 3) {
  for (let i = 0; i < retries; i++) {
    try {
      const res = await axios.get(`${FB_GRAPH}${path}`, { params, timeout: 30000 });
      return res.data;
    } catch (err) {
      const fbErr = err.response?.data?.error;
      if (fbErr?.code === 190) throw new Error('Facebook Token hết hạn hoặc không hợp lệ');
      if (i === retries - 1) throw err;
      await sleep(1500 * (i + 1));
    }
  }
}

async function fetchAllPages(path, params = {}, maxPages = 30) {
  const results = [];
  let nextUrl = null;
  let page = 0;

  const firstData = await fbGet(path, params);
  if (firstData.data) results.push(...firstData.data);
  nextUrl = firstData.paging?.next || null;
  page++;

  while (nextUrl && page < maxPages) {
    // next URL đã có đầy đủ params, dùng trực tiếp
    const parsed = new URL(nextUrl);
    const nextPath = parsed.pathname;
    const nextParams = Object.fromEntries(parsed.searchParams);
    const data = await fbGet(nextPath, nextParams);
    if (data.data) results.push(...data.data);
    nextUrl = data.paging?.next || null;
    page++;
    await sleep(300);
  }
  return results;
}

// ── Hàm fetch chính (dùng chung cho script và API) ───────────
async function fetchAndSaveMessages(user, options = {}) {
  const { daysBack = 90, onlyPageId = null, onProgress = null } = options;
  const sinceDate = new Date(Date.now() - daysBack * 24 * 60 * 60 * 1000);

  let pages = [];
  try { pages = JSON.parse(user.fbPages || '[]'); } catch {}

  if (!pages.length) {
    const pagesData = await fbGet('/me/accounts', {
      fields: 'id,name,access_token,category',
      limit: 200,
      access_token: user.fbToken,
    });
    pages = pagesData.data || [];
  }

  if (onlyPageId) pages = pages.filter(p => p.id === onlyPageId);

  const stats = { pages: 0, conversations: 0, messages: 0, errors: [] };

  for (const page of pages) {
    if (!page.access_token) continue;
    stats.pages++;

    if (onProgress) onProgress({ type: 'page', name: page.name, id: page.id });

    // Lấy conversations
    let conversations = [];
    try {
      conversations = await fetchAllPages(`/${page.id}/conversations`, {
        fields: 'id,snippet,updated_time,unread_count,can_reply,participants',
        limit: 100,
        access_token: page.access_token,
      }, 20);
    } catch (err) {
      stats.errors.push(`Page ${page.name}: ${err.message}`);
      continue;
    }

    stats.conversations += conversations.length;

    for (const conv of conversations) {
      const convUpdated = new Date(conv.updated_time);
      if (convUpdated < sinceDate) continue;

      const participants = conv.participants?.data || [];
      const participant  = participants.find(p => p.id !== page.id) || participants[0];

      // Upsert conversation
      await prisma.conversation.upsert({
        where: { id: conv.id },
        create: {
          id:              conv.id,
          pageId:          page.id,
          pageName:        page.name,
          participantId:   participant?.id || null,
          participantName: participant?.name || null,
          snippet:         conv.snippet || null,
          unreadCount:     conv.unread_count || 0,
          updatedTime:     convUpdated,
          canReply:        conv.can_reply !== false,
          ownerId:         user.id,
        },
        update: {
          snippet:     conv.snippet || null,
          unreadCount: conv.unread_count || 0,
          updatedTime: convUpdated,
          canReply:    conv.can_reply !== false,
          fetchedAt:   new Date(),
        },
      });

      // Lấy messages
      let messages = [];
      try {
        messages = await fetchAllPages(`/${conv.id}/messages`, {
          fields: 'id,from,to,message,attachments,created_time',
          limit: 100,
          access_token: page.access_token,
        }, 30);
      } catch (err) {
        stats.errors.push(`Conv ${conv.id}: ${err.message}`);
        continue;
      }

      stats.messages += messages.length;

      // Upsert messages theo batch
      for (const msg of messages) {
        const fromId     = msg.from?.id || null;
        const fromName   = msg.from?.name || null;
        const toEntry    = msg.to?.data?.[0] || null;
        const attachments = msg.attachments?.data
          ? JSON.stringify(msg.attachments.data)
          : '[]';

        await prisma.message.upsert({
          where: { id: msg.id },
          create: {
            id:             msg.id,
            conversationId: conv.id,
            pageId:         page.id,
            fromId,
            fromName,
            toId:           toEntry?.id || null,
            toName:         toEntry?.name || null,
            message:        msg.message || null,
            attachments,
            isFromPage:     fromId === page.id,
            createdTime:    msg.created_time ? new Date(msg.created_time) : null,
          },
          update: {
            message:    msg.message || null,
            attachments,
            fetchedAt:  new Date(),
          },
        });
      }

      await sleep(200);
    }

    await sleep(500);
  }

  return stats;
}

// ── POST /api/messages/fetch ──────────────────────────────────
// Trigger fetch tin nhắn cho user đang đăng nhập
router.post('/fetch', authMiddleware, async (req, res) => {
  const { days = 90, page_id = null } = req.body;

  try {
    const user = await prisma.user.findUnique({ where: { id: req.user.id } });
    if (!user) return res.status(404).json({ error: 'Không tìm thấy user' });
    if (!user.fbToken) return res.status(400).json({ error: 'Chưa kết nối Facebook' });

    // Trả về ngay, chạy background
    res.json({
      success: true,
      message: `Đang fetch tin nhắn trong ${days} ngày qua. Quá trình có thể mất vài phút.`,
      status: 'running',
    });

    // Chạy background (không await)
    fetchAndSaveMessages(user, {
      daysBack: parseInt(days),
      onlyPageId: page_id,
    }).then(stats => {
      console.log(`[Messages/Fetch] User ${user.email}: ${stats.conversations} convs, ${stats.messages} msgs`);
    }).catch(err => {
      console.error(`[Messages/Fetch] Error for ${user.email}:`, err.message);
    });

  } catch (err) {
    console.error('[Messages/Fetch]', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── POST /api/messages/fetch-sync ────────────────────────────
// Fetch đồng bộ (chờ kết quả) — dùng cho admin/script
router.post('/fetch-sync', authMiddleware, async (req, res) => {
  const { days = 90, page_id = null } = req.body;

  try {
    const user = await prisma.user.findUnique({ where: { id: req.user.id } });
    if (!user) return res.status(404).json({ error: 'Không tìm thấy user' });
    if (!user.fbToken) return res.status(400).json({ error: 'Chưa kết nối Facebook' });

    const stats = await fetchAndSaveMessages(user, {
      daysBack: parseInt(days),
      onlyPageId: page_id,
    });

    res.json({
      success: true,
      stats,
      message: `Đã lưu ${stats.messages} tin nhắn từ ${stats.conversations} cuộc hội thoại trên ${stats.pages} Pages`,
    });
  } catch (err) {
    console.error('[Messages/FetchSync]', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── GET /api/messages/conversations ──────────────────────────
router.get('/conversations', authMiddleware, async (req, res) => {
  try {
    const { page_id, limit = 50, offset = 0, search } = req.query;

    const where = {
      ownerId: req.user.id,
      ...(page_id ? { pageId: page_id } : {}),
      ...(search ? {
        OR: [
          { participantName: { contains: search, mode: 'insensitive' } },
          { snippet: { contains: search, mode: 'insensitive' } },
        ],
      } : {}),
    };

    const [conversations, total] = await Promise.all([
      prisma.conversation.findMany({
        where,
        orderBy: { updatedTime: 'desc' },
        take: parseInt(limit),
        skip: parseInt(offset),
        include: {
          _count: { select: { messages: true } },
        },
      }),
      prisma.conversation.count({ where }),
    ]);

    res.json({
      conversations,
      total,
      limit: parseInt(limit),
      offset: parseInt(offset),
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── GET /api/messages/conversations/:id/messages ──────────────
router.get('/conversations/:id/messages', authMiddleware, async (req, res) => {
  try {
    const { limit = 100, offset = 0 } = req.query;

    // Kiểm tra conversation thuộc về user
    const conv = await prisma.conversation.findFirst({
      where: { id: req.params.id, ownerId: req.user.id },
    });
    if (!conv) return res.status(404).json({ error: 'Không tìm thấy conversation' });

    const [messages, total] = await Promise.all([
      prisma.message.findMany({
        where: { conversationId: req.params.id },
        orderBy: { createdTime: 'asc' },
        take: parseInt(limit),
        skip: parseInt(offset),
      }),
      prisma.message.count({ where: { conversationId: req.params.id } }),
    ]);

    res.json({ conversation: conv, messages, total });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── GET /api/messages/stats ───────────────────────────────────
router.get('/stats', authMiddleware, async (req, res) => {
  try {
    const [totalConvs, totalMsgs, pages] = await Promise.all([
      prisma.conversation.count({ where: { ownerId: req.user.id } }),
      prisma.message.count({
        where: { conversation: { ownerId: req.user.id } },
      }),
      prisma.conversation.groupBy({
        by: ['pageId', 'pageName'],
        where: { ownerId: req.user.id },
        _count: { id: true },
      }),
    ]);

    res.json({
      totalConversations: totalConvs,
      totalMessages: totalMsgs,
      byPage: pages.map(p => ({
        pageId: p.pageId,
        pageName: p.pageName,
        conversations: p._count.id,
      })),
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
module.exports.fetchAndSaveMessages = fetchAndSaveMessages;
