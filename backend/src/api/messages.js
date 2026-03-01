/**
 * GenzTech — Messages API (Proxy + Cache)
 *
 * Kiến trúc:
 *  - Frontend gọi backend (không gọi Facebook trực tiếp)
 *  - Backend trả cache từ DB ngay lập tức
 *  - Backend fetch incremental từ Facebook (chỉ tin mới hơn cursor)
 *  - Lưu kết quả vào DB để lần sau không fetch lại
 *
 * Endpoints:
 *  GET  /api/messages/pages/:pageId/conversations          — Danh sách conversations (cache + sync)
 *  GET  /api/messages/conversations/:convId/messages       — Messages trong conv (cache + sync)
 *  POST /api/messages/conversations/:convId/reply          — Gửi tin nhắn qua backend
 *  GET  /api/messages/stats                                — Thống kê
 */

const express = require('express');
const axios   = require('axios');
const { PrismaClient } = require('@prisma/client');
const { authMiddleware } = require('../middleware/auth');

const router  = express.Router();
const prisma  = new PrismaClient();
const FB_GRAPH = 'https://graph.facebook.com/v19.0';

// ── Thời gian cache hợp lệ: 2 phút ──────────────────────────
const CACHE_TTL_MS = 2 * 60 * 1000;

// ── Helper: gọi Facebook Graph API ───────────────────────────
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function fbGet(path, params = {}, retries = 3) {
  for (let i = 0; i < retries; i++) {
    try {
      const res = await axios.get(`${FB_GRAPH}${path}`, { params, timeout: 20000 });
      return res.data;
    } catch (err) {
      const fbErr = err.response?.data?.error;
      if (fbErr?.code === 190) throw new Error('Facebook Token hết hạn hoặc không hợp lệ');
      if (fbErr?.code === 10 || fbErr?.code === 200) throw new Error(`Không có quyền: ${fbErr?.message}`);
      if (i === retries - 1) throw new Error(fbErr?.message || err.message);
      await sleep(1000 * (i + 1));
    }
  }
}

// ── Helper: lấy page token của user ──────────────────────────
function getPageToken(user, pageId) {
  let pages = [];
  try { pages = JSON.parse(user.fbPages || '[]'); } catch {}
  const page = pages.find(p => p.id === pageId);
  return page?.access_token || null;
}

// ── Helper: Sync conversations của 1 page từ FB → DB ─────────
async function syncConversations(user, pageId, pageToken) {
  const data = await fbGet(`/${pageId}/conversations`, {
    fields: 'id,snippet,updated_time,unread_count,can_reply,participants',
    limit: 100,
    access_token: pageToken,
  });

  const conversations = data?.data || [];

  for (const conv of conversations) {
    const participants = conv.participants?.data || [];
    const participant  = participants.find(p => p.id !== pageId) || participants[0];

    await prisma.conversation.upsert({
      where: { id: conv.id },
      create: {
        id:              conv.id,
        pageId,
        pageName:        null,
        participantId:   participant?.id || null,
        participantName: participant?.name || null,
        snippet:         conv.snippet || null,
        unreadCount:     conv.unread_count || 0,
        updatedTime:     conv.updated_time ? new Date(conv.updated_time) : new Date(),
        canReply:        conv.can_reply !== false,
        ownerId:         user.id,
        fetchedAt:       new Date(),
      },
      update: {
        participantId:   participant?.id || null,
        participantName: participant?.name || null,
        snippet:         conv.snippet || null,
        unreadCount:     conv.unread_count || 0,
        updatedTime:     conv.updated_time ? new Date(conv.updated_time) : new Date(),
        canReply:        conv.can_reply !== false,
        fetchedAt:       new Date(),
      },
    });
  }

  return conversations.length;
}

// ── Helper: Sync messages mới nhất của 1 conversation ────────
// Chỉ lấy tin nhắn mới hơn tin nhắn đã cache (incremental)
async function syncMessages(convId, pageToken, pageId) {
  // Tìm tin nhắn mới nhất đã có trong DB (cursor)
  const latestMsg = await prisma.message.findFirst({
    where: { conversationId: convId },
    orderBy: { createdTime: 'desc' },
    select: { id: true, createdTime: true },
  });

  // Lấy tin nhắn từ Facebook (chỉ 1 trang = 25 tin mới nhất)
  const data = await fbGet(`/${convId}/messages`, {
    fields: 'id,from,to,message,attachments,created_time',
    limit: 25,
    access_token: pageToken,
  });

  const fbMessages = data?.data || [];
  let newCount = 0;

  for (const msg of fbMessages) {
    // Bỏ qua nếu tin nhắn đã có trong DB (so sánh theo ID)
    if (latestMsg && msg.id === latestMsg.id) break;

    const fromId     = msg.from?.id || null;
    const toEntry    = msg.to?.data?.[0] || null;
    const attachments = msg.attachments?.data
      ? JSON.stringify(msg.attachments.data)
      : '[]';

    try {
      await prisma.message.upsert({
        where: { id: msg.id },
        create: {
          id:             msg.id,
          conversationId: convId,
          pageId,
          fromId,
          fromName:       msg.from?.name || null,
          toId:           toEntry?.id || null,
          toName:         toEntry?.name || null,
          message:        msg.message || null,
          attachments,
          isFromPage:     fromId === pageId,
          createdTime:    msg.created_time ? new Date(msg.created_time) : null,
          fetchedAt:      new Date(),
        },
        update: {
          message:    msg.message || null,
          fetchedAt:  new Date(),
        },
      });
      newCount++;
    } catch (e) {
      // Bỏ qua lỗi duplicate
    }
  }

  return { total: fbMessages.length, new: newCount };
}

// ════════════════════════════════════════════════════════════
// GET /api/messages/pages/:pageId/conversations
// Trả về danh sách conversations từ cache, đồng thời sync từ FB
// ════════════════════════════════════════════════════════════
router.get('/pages/:pageId/conversations', authMiddleware, async (req, res) => {
  const { pageId } = req.params;
  const { limit = 50, offset = 0, search } = req.query;

  try {
    const user = await prisma.user.findUnique({ where: { id: req.user.id } });
    if (!user) return res.status(404).json({ error: 'Không tìm thấy user' });

    const pageToken = getPageToken(user, pageId);
    if (!pageToken) return res.status(400).json({ error: `Không tìm thấy token cho page ${pageId}` });

    // 1. Trả cache từ DB ngay lập tức
    const where = {
      ownerId: user.id,
      pageId,
      ...(search ? {
        OR: [
          { participantName: { contains: search, mode: 'insensitive' } },
          { snippet: { contains: search, mode: 'insensitive' } },
        ],
      } : {}),
    };

    const [cachedConvs, total] = await Promise.all([
      prisma.conversation.findMany({
        where,
        orderBy: { updatedTime: 'desc' },
        take: parseInt(limit),
        skip: parseInt(offset),
        include: { _count: { select: { messages: true } } },
      }),
      prisma.conversation.count({ where }),
    ]);

    // Kiểm tra cache có cũ không (so sánh fetchedAt của conv mới nhất)
    const latestConv = cachedConvs[0];
    const cacheAge   = latestConv ? Date.now() - new Date(latestConv.fetchedAt).getTime() : Infinity;
    const needSync   = cacheAge > CACHE_TTL_MS;

    // 2. Gửi cache về client ngay
    res.json({
      conversations: cachedConvs,
      total,
      fromCache: true,
      syncing: needSync,
      cacheAgeMs: Math.round(cacheAge),
    });

    // 3. Nếu cache cũ → sync từ FB ở background
    if (needSync) {
      syncConversations(user, pageId, pageToken)
        .then(count => console.log(`[Messages] Synced ${count} conversations for page ${pageId}`))
        .catch(err  => console.error(`[Messages] Sync conversations error:`, err.message));
    }

  } catch (err) {
    console.error('[Messages/Conversations]', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ════════════════════════════════════════════════════════════
// GET /api/messages/conversations/:convId/messages
// Trả về messages từ cache, fetch incremental tin mới từ FB
// ════════════════════════════════════════════════════════════
router.get('/conversations/:convId/messages', authMiddleware, async (req, res) => {
  const { convId } = req.params;
  const { limit = 50, offset = 0 } = req.query;

  try {
    const user = await prisma.user.findUnique({ where: { id: req.user.id } });
    if (!user) return res.status(404).json({ error: 'Không tìm thấy user' });

    // Kiểm tra conversation thuộc về user
    const conv = await prisma.conversation.findFirst({
      where: { id: convId, ownerId: user.id },
    });

    // Nếu chưa có conversation trong DB → tạo mới từ FB
    let pageId    = conv?.pageId;
    let pageToken = pageId ? getPageToken(user, pageId) : null;

    if (!conv) {
      // Thử tìm pageId từ convId (Facebook conv ID có thể chứa pageId)
      // Hoặc user phải truyền pageId qua query
      pageId = req.query.page_id;
      if (!pageId) {
        return res.status(400).json({
          error: 'Conversation chưa có trong cache. Vui lòng truyền thêm ?page_id=<PAGE_ID>',
        });
      }
      pageToken = getPageToken(user, pageId);
      if (!pageToken) return res.status(400).json({ error: `Không tìm thấy token cho page ${pageId}` });
    }

    // 1. Lấy messages từ cache DB
    const [cachedMessages, total] = await Promise.all([
      prisma.message.findMany({
        where: { conversationId: convId },
        orderBy: { createdTime: 'asc' },
        take: parseInt(limit),
        skip: parseInt(offset),
      }),
      prisma.message.count({ where: { conversationId: convId } }),
    ]);

    // Kiểm tra cache có cũ không
    const latestMsg  = cachedMessages[cachedMessages.length - 1];
    const cacheAge   = latestMsg ? Date.now() - new Date(latestMsg.fetchedAt || 0).getTime() : Infinity;
    const needSync   = cacheAge > CACHE_TTL_MS || cachedMessages.length === 0;

    // 2. Gửi cache về client ngay
    res.json({
      conversation: conv,
      messages:     cachedMessages,
      total,
      fromCache:    cachedMessages.length > 0,
      syncing:      needSync,
      cacheAgeMs:   Math.round(cacheAge),
    });

    // 3. Fetch incremental từ FB ở background (chỉ lấy tin mới)
    if (needSync && pageToken && pageId) {
      syncMessages(convId, pageToken, pageId)
        .then(r => console.log(`[Messages] Conv ${convId}: +${r.new} new msgs (checked ${r.total})`))
        .catch(err => console.error(`[Messages] Sync messages error:`, err.message));
    }

  } catch (err) {
    console.error('[Messages/GetMessages]', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ════════════════════════════════════════════════════════════
// GET /api/messages/conversations/:convId/messages/refresh
// Force refresh: đồng bộ ngay từ FB và trả kết quả mới
// ════════════════════════════════════════════════════════════
router.get('/conversations/:convId/messages/refresh', authMiddleware, async (req, res) => {
  const { convId } = req.params;

  try {
    const user = await prisma.user.findUnique({ where: { id: req.user.id } });
    if (!user) return res.status(404).json({ error: 'Không tìm thấy user' });

    const conv = await prisma.conversation.findFirst({
      where: { id: convId, ownerId: user.id },
    });

    const pageId    = conv?.pageId || req.query.page_id;
    const pageToken = pageId ? getPageToken(user, pageId) : null;

    if (!pageToken) return res.status(400).json({ error: 'Không tìm thấy page token' });

    // Fetch đồng bộ từ FB
    const syncResult = await syncMessages(convId, pageToken, pageId);

    // Lấy messages mới nhất từ DB
    const { limit = 50 } = req.query;
    const [messages, total] = await Promise.all([
      prisma.message.findMany({
        where: { conversationId: convId },
        orderBy: { createdTime: 'asc' },
        take: parseInt(limit),
      }),
      prisma.message.count({ where: { conversationId: convId } }),
    ]);

    res.json({
      conversation: conv,
      messages,
      total,
      fromCache: false,
      newMessages: syncResult.new,
    });

  } catch (err) {
    console.error('[Messages/Refresh]', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ════════════════════════════════════════════════════════════
// POST /api/messages/conversations/:convId/reply
// Gửi tin nhắn qua backend (không cần lộ page token ra frontend)
// ════════════════════════════════════════════════════════════
router.post('/conversations/:convId/reply', authMiddleware, async (req, res) => {
  const { convId } = req.params;
  const { message, recipient_id } = req.body;

  if (!message || !recipient_id) {
    return res.status(400).json({ error: 'Thiếu message hoặc recipient_id' });
  }

  try {
    const user = await prisma.user.findUnique({ where: { id: req.user.id } });
    if (!user) return res.status(404).json({ error: 'Không tìm thấy user' });

    const conv = await prisma.conversation.findFirst({
      where: { id: convId, ownerId: user.id },
    });
    if (!conv) return res.status(404).json({ error: 'Không tìm thấy conversation' });

    const pageToken = getPageToken(user, conv.pageId);
    if (!pageToken) return res.status(400).json({ error: 'Không tìm thấy page token' });

    // Gửi tin nhắn qua Facebook API
    const fbRes = await axios.post(
      `${FB_GRAPH}/me/messages?access_token=${pageToken}`,
      {
        recipient: { id: recipient_id },
        message:   { text: message },
        messaging_type: 'RESPONSE',
      },
      { timeout: 15000 }
    );

    // Lưu tin nhắn vào DB
    const msgId = fbRes.data?.message_id;
    if (msgId) {
      await prisma.message.create({
        data: {
          id:             msgId,
          conversationId: convId,
          pageId:         conv.pageId,
          fromId:         conv.pageId,
          fromName:       conv.pageName || 'Page',
          toId:           recipient_id,
          toName:         conv.participantName || null,
          message,
          attachments:    '[]',
          isFromPage:     true,
          createdTime:    new Date(),
          fetchedAt:      new Date(),
        },
      }).catch(() => {}); // Bỏ qua nếu đã tồn tại
    }

    res.json({
      success: true,
      message_id: msgId,
      recipient_id,
    });

  } catch (err) {
    const fbErr = err.response?.data?.error;
    console.error('[Messages/Reply]', fbErr?.message || err.message);
    res.status(500).json({ error: fbErr?.message || err.message });
  }
});

// ════════════════════════════════════════════════════════════
// GET /api/messages/stats
// ════════════════════════════════════════════════════════════
router.get('/stats', authMiddleware, async (req, res) => {
  try {
    const [totalConvs, totalMsgs, byPage] = await Promise.all([
      prisma.conversation.count({ where: { ownerId: req.user.id } }),
      prisma.message.count({
        where: { conversation: { ownerId: req.user.id } },
      }),
      prisma.conversation.groupBy({
        by: ['pageId', 'pageName'],
        where: { ownerId: req.user.id },
        _count: { id: true },
        _max: { fetchedAt: true },
      }),
    ]);

    res.json({
      totalConversations: totalConvs,
      totalMessages: totalMsgs,
      byPage: byPage.map(p => ({
        pageId:        p.pageId,
        pageName:      p.pageName,
        conversations: p._count.id,
        lastSynced:    p._max.fetchedAt,
      })),
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ════════════════════════════════════════════════════════════
// POST /api/messages/pages/:pageId/sync
// Force sync toàn bộ conversations của 1 page
// ════════════════════════════════════════════════════════════
router.post('/pages/:pageId/sync', authMiddleware, async (req, res) => {
  const { pageId } = req.params;

  try {
    const user = await prisma.user.findUnique({ where: { id: req.user.id } });
    if (!user) return res.status(404).json({ error: 'Không tìm thấy user' });

    const pageToken = getPageToken(user, pageId);
    if (!pageToken) return res.status(400).json({ error: `Không tìm thấy token cho page ${pageId}` });

    const count = await syncConversations(user, pageId, pageToken);

    res.json({
      success: true,
      synced: count,
      message: `Đã đồng bộ ${count} conversations từ Page ${pageId}`,
    });
  } catch (err) {
    console.error('[Messages/Sync]', err.message);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
