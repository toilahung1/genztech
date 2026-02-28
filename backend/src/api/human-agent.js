/**
 * AI Human Agent — GenzTech Backend
 * Webhook Messenger + GPT-4 + RAG + Multi-Page Management
 */
const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { OpenAI } = require('openai');

// ── DB helper ──────────────────────────────────────────
let db;
try { db = require('../db'); } catch { db = null; }

// ── OpenAI ─────────────────────────────────────────────
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
  baseURL: process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1'
});

// ── Multer: upload tài liệu ────────────────────────────
const UPLOAD_DIR = path.join(__dirname, '../../uploads/human-agent');
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const upload = multer({
  dest: UPLOAD_DIR,
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB
  fileFilter: (req, file, cb) => {
    const allowed = ['.txt', '.md', '.pdf', '.docx', '.doc', '.csv', '.json', '.html'];
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, allowed.includes(ext));
  }
});

// ── In-memory store (fallback khi không có DB) ─────────
const store = {
  pages: new Map(),       // pageId → PageConfig
  conversations: new Map(), // `${pageId}:${userId}` → ConvData
  documents: new Map(),   // `${pageId}:${docId}` → DocData
  rules: new Map(),       // `${pageId}:${ruleId}` → RuleData
};

// ── Helpers ────────────────────────────────────────────
function genId() { return crypto.randomBytes(8).toString('hex'); }

function getPage(pageId) {
  if (!store.pages.has(pageId)) {
    store.pages.set(pageId, {
      pageId,
      pageName: pageId,
      pageAvatar: null,
      pageAccessToken: null,
      enabled: false,
      documentCount: 0,
      ruleCount: 0,
      aiConfig: {
        systemPrompt: 'Bạn là trợ lý AI chăm sóc khách hàng chuyên nghiệp. Hãy trả lời thân thiện, ngắn gọn và chính xác.',
        maxTokens: 500,
        language: 'vi'
      },
      createdAt: Date.now()
    });
  }
  return store.pages.get(pageId);
}

function getConvKey(pageId, userId) { return `${pageId}:${userId}`; }

function getConv(pageId, userId) {
  const key = getConvKey(pageId, userId);
  if (!store.conversations.has(key)) {
    store.conversations.set(key, {
      pageId, userId,
      messages: [],
      isPending: false,
      unread: 0,
      lastMessage: '',
      lastTimestamp: Date.now()
    });
  }
  return store.conversations.get(key);
}

// ── Extract text from uploaded file ───────────────────
async function extractText(filePath, ext) {
  try {
    if (['.txt', '.md', '.csv', '.json', '.html'].includes(ext)) {
      return fs.readFileSync(filePath, 'utf8');
    }
    if (ext === '.pdf') {
      try {
        const pdfParse = require('pdf-parse');
        const buf = fs.readFileSync(filePath);
        const data = await pdfParse(buf);
        return data.text;
      } catch {
        return fs.readFileSync(filePath, 'utf8');
      }
    }
    if (['.docx', '.doc'].includes(ext)) {
      try {
        const mammoth = require('mammoth');
        const result = await mammoth.extractRawText({ path: filePath });
        return result.value;
      } catch {
        return fs.readFileSync(filePath, 'utf8');
      }
    }
    return fs.readFileSync(filePath, 'utf8');
  } catch {
    return '';
  }
}

// ── RAG: build context from documents + rules ─────────
function buildContext(pageId, userMessage) {
  const docs = [];
  const rules = [];

  for (const [key, doc] of store.documents) {
    if (key.startsWith(`${pageId}:`)) docs.push(doc);
  }
  for (const [key, rule] of store.rules) {
    if (key.startsWith(`${pageId}:`)) rules.push(rule);
  }

  let context = '';

  // Rules: exact/fuzzy match first
  const msgLower = userMessage.toLowerCase();
  const matchedRules = rules.filter(r =>
    msgLower.includes(r.trigger.toLowerCase()) ||
    r.trigger.toLowerCase().split(/[\s,]+/).some(kw => kw.length > 2 && msgLower.includes(kw))
  );

  if (matchedRules.length > 0) {
    context += '=== QUY TẮC LIÊN QUAN ===\n';
    for (const r of matchedRules.slice(0, 5)) {
      context += `Chủ đề: ${r.trigger}\nTrả lời: ${r.response}\n\n`;
    }
  }

  // Documents: simple keyword search
  if (docs.length > 0) {
    const keywords = userMessage.toLowerCase().split(/\s+/).filter(w => w.length > 2);
    const scored = docs.map(d => {
      const textLower = (d.content || '').toLowerCase();
      const score = keywords.reduce((s, kw) => s + (textLower.split(kw).length - 1), 0);
      return { ...d, score };
    }).sort((a, b) => b.score - a.score);

    const relevant = scored.filter(d => d.score > 0).slice(0, 3);
    if (relevant.length > 0) {
      context += '=== TÀI LIỆU THAM KHẢO ===\n';
      for (const d of relevant) {
        // Lấy đoạn văn bản liên quan nhất (tối đa 800 ký tự)
        const content = d.content || '';
        const idx = content.toLowerCase().indexOf(keywords[0] || '');
        const start = Math.max(0, idx - 200);
        const snippet = content.slice(start, start + 800);
        context += `[${d.name}]\n${snippet}\n\n`;
      }
    }
  }

  return context.trim();
}

// ── AI Reply ───────────────────────────────────────────
async function generateAIReply(pageId, userId, userMessage) {
  const page = getPage(pageId);
  const conv = getConv(pageId, userId);
  const config = page.aiConfig || {};

  const context = buildContext(pageId, userMessage);
  const systemPrompt = [
    config.systemPrompt || 'Bạn là trợ lý AI chăm sóc khách hàng chuyên nghiệp.',
    context ? `\nDưới đây là thông tin tham khảo để trả lời:\n${context}` : '',
    '\nHướng dẫn: Trả lời ngắn gọn, thân thiện. Nếu không có thông tin, hãy nói "Tôi sẽ chuyển bạn đến nhân viên hỗ trợ".',
    config.language === 'vi' ? '\nLuôn trả lời bằng tiếng Việt.' : ''
  ].filter(Boolean).join('\n');

  // Lấy lịch sử chat gần nhất (tối đa 10 tin)
  const history = conv.messages.slice(-10).map(m => ({
    role: m.role === 'user' ? 'user' : 'assistant',
    content: m.content
  }));

  const messages = [
    { role: 'system', content: systemPrompt },
    ...history,
    { role: 'user', content: userMessage }
  ];

  const response = await openai.chat.completions.create({
    model: 'gpt-4o-mini',
    messages,
    max_tokens: config.maxTokens || 500,
    temperature: 0.7
  });

  const reply = response.choices[0]?.message?.content || 'Xin lỗi, tôi không thể trả lời lúc này.';

  // Kiểm tra xem có cần chuyển human agent không
  const needsHuman = /nhân viên|hỗ trợ trực tiếp|không có thông tin|liên hệ|gặp người thật/i.test(reply);

  return { reply, needsHuman };
}

// ── Send Messenger message ─────────────────────────────
async function sendMessengerMessage(pageAccessToken, recipientId, message, useHumanTag = false) {
  const body = {
    recipient: { id: recipientId },
    message: { text: message }
  };

  if (useHumanTag) {
    body.messaging_type = 'MESSAGE_TAG';
    body.tag = 'HUMAN_AGENT';
  }

  const r = await fetch(`https://graph.facebook.com/v19.0/me/messages?access_token=${pageAccessToken}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });

  const data = await r.json();
  if (data.error) throw new Error(data.error.message);
  return data;
}

// ═══════════════════════════════════════════════════════
// ROUTES: Pages
// ═══════════════════════════════════════════════════════

// GET /api/human-agent/pages — Lấy danh sách pages
router.get('/pages', (req, res) => {
  const pages = Array.from(store.pages.values());
  res.json({ pages });
});

// POST /api/human-agent/pages/sync — Đồng bộ pages từ Facebook
router.post('/pages/sync', async (req, res) => {
  try {
    const { accessToken } = req.body;
    if (!accessToken) return res.status(400).json({ error: 'Thiếu accessToken' });

    const r = await fetch(`https://graph.facebook.com/v19.0/me/accounts?fields=id,name,picture,access_token&access_token=${accessToken}`);
    const data = await r.json();

    if (data.error) return res.status(400).json({ error: data.error.message });

    const pages = data.data || [];
    for (const p of pages) {
      const existing = store.pages.get(p.id) || {};
      store.pages.set(p.id, {
        ...existing,
        pageId: p.id,
        pageName: p.name,
        pageAvatar: p.picture?.data?.url || null,
        pageAccessToken: p.access_token,
        documentCount: existing.documentCount || 0,
        ruleCount: existing.ruleCount || 0,
        aiConfig: existing.aiConfig || {
          systemPrompt: `Bạn là trợ lý AI chăm sóc khách hàng của ${p.name}. Hãy trả lời thân thiện, ngắn gọn và chính xác.`,
          maxTokens: 500,
          language: 'vi'
        },
        enabled: existing.enabled || false,
        createdAt: existing.createdAt || Date.now()
      });
    }

    res.json({ count: pages.length, pages: Array.from(store.pages.values()) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/human-agent/pages/:pageId — Cập nhật cấu hình page
router.put('/pages/:pageId', (req, res) => {
  const page = getPage(req.params.pageId);
  const { enabled, aiConfig } = req.body;
  if (typeof enabled === 'boolean') page.enabled = enabled;
  if (aiConfig) page.aiConfig = { ...page.aiConfig, ...aiConfig };
  store.pages.set(req.params.pageId, page);
  res.json({ success: true, page });
});

// POST /api/human-agent/pages/:pageId/subscribe — Đăng ký webhook
router.post('/pages/:pageId/subscribe', async (req, res) => {
  try {
    const page = getPage(req.params.pageId);
    if (!page.pageAccessToken) return res.status(400).json({ error: 'Chưa có Page Access Token' });

    const r = await fetch(`https://graph.facebook.com/v19.0/${req.params.pageId}/subscribed_apps`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        subscribed_fields: ['messages', 'messaging_postbacks', 'messaging_seen'],
        access_token: page.pageAccessToken
      })
    });
    const data = await r.json();
    if (data.error) return res.status(400).json({ error: data.error.message });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ═══════════════════════════════════════════════════════
// ROUTES: Documents
// ═══════════════════════════════════════════════════════

// GET /api/human-agent/pages/:pageId/documents
router.get('/pages/:pageId/documents', (req, res) => {
  const { pageId } = req.params;
  const docs = [];
  for (const [key, doc] of store.documents) {
    if (key.startsWith(`${pageId}:`)) docs.push(doc);
  }
  res.json({ documents: docs });
});

// POST /api/human-agent/pages/:pageId/documents — Upload tài liệu
router.post('/pages/:pageId/documents', upload.array('files', 20), async (req, res) => {
  const { pageId } = req.params;
  const uploaded = [];

  for (const file of (req.files || [])) {
    const ext = path.extname(file.originalname).toLowerCase();
    const docId = genId();
    const content = await extractText(file.path, ext);

    const doc = {
      id: docId,
      pageId,
      name: file.originalname,
      ext,
      size: file.size,
      chars: content.length,
      content,
      filePath: file.path,
      createdAt: Date.now()
    };

    store.documents.set(`${pageId}:${docId}`, doc);
    uploaded.push({ id: docId, name: doc.name, size: doc.size, chars: doc.chars });
  }

  // Update page document count
  const page = getPage(pageId);
  page.documentCount = Array.from(store.documents.keys()).filter(k => k.startsWith(`${pageId}:`)).length;
  store.pages.set(pageId, page);

  res.json({ uploaded });
});

// DELETE /api/human-agent/pages/:pageId/documents/:docId
router.delete('/pages/:pageId/documents/:docId', (req, res) => {
  const { pageId, docId } = req.params;
  const key = `${pageId}:${docId}`;
  const doc = store.documents.get(key);
  if (doc?.filePath) {
    try { fs.unlinkSync(doc.filePath); } catch {}
  }
  store.documents.delete(key);
  const page = getPage(pageId);
  page.documentCount = Math.max(0, page.documentCount - 1);
  store.pages.set(pageId, page);
  res.json({ success: true });
});

// ═══════════════════════════════════════════════════════
// ROUTES: Rules
// ═══════════════════════════════════════════════════════

// GET /api/human-agent/pages/:pageId/rules
router.get('/pages/:pageId/rules', (req, res) => {
  const { pageId } = req.params;
  const rules = [];
  for (const [key, rule] of store.rules) {
    if (key.startsWith(`${pageId}:`)) rules.push(rule);
  }
  res.json({ rules });
});

// POST /api/human-agent/pages/:pageId/rules
router.post('/pages/:pageId/rules', (req, res) => {
  const { pageId } = req.params;
  const { trigger, response, category } = req.body;
  if (!trigger || !response) return res.status(400).json({ error: 'Thiếu trigger hoặc response' });

  const ruleId = genId();
  const rule = { id: ruleId, pageId, trigger, response, category: category || 'general', createdAt: Date.now() };
  store.rules.set(`${pageId}:${ruleId}`, rule);

  const page = getPage(pageId);
  page.ruleCount = Array.from(store.rules.keys()).filter(k => k.startsWith(`${pageId}:`)).length;
  store.pages.set(pageId, page);

  res.json({ success: true, rule });
});

// PUT /api/human-agent/pages/:pageId/rules/:ruleId
router.put('/pages/:pageId/rules/:ruleId', (req, res) => {
  const { pageId, ruleId } = req.params;
  const key = `${pageId}:${ruleId}`;
  const rule = store.rules.get(key);
  if (!rule) return res.status(404).json({ error: 'Không tìm thấy quy tắc' });

  const { trigger, response, category } = req.body;
  if (trigger) rule.trigger = trigger;
  if (response) rule.response = response;
  if (category) rule.category = category;
  rule.updatedAt = Date.now();
  store.rules.set(key, rule);

  res.json({ success: true, rule });
});

// DELETE /api/human-agent/pages/:pageId/rules/:ruleId
router.delete('/pages/:pageId/rules/:ruleId', (req, res) => {
  const { pageId, ruleId } = req.params;
  store.rules.delete(`${pageId}:${ruleId}`);
  const page = getPage(pageId);
  page.ruleCount = Math.max(0, page.ruleCount - 1);
  store.pages.set(pageId, page);
  res.json({ success: true });
});

// ═══════════════════════════════════════════════════════
// ROUTES: Conversations
// ═══════════════════════════════════════════════════════

// GET /api/human-agent/pages/:pageId/conversations
router.get('/pages/:pageId/conversations', (req, res) => {
  const { pageId } = req.params;
  const convs = [];
  for (const [key, conv] of store.conversations) {
    if (key.startsWith(`${pageId}:`)) {
      convs.push({
        pageId: conv.pageId,
        userId: conv.userId,
        lastMessage: conv.lastMessage,
        lastTimestamp: conv.lastTimestamp,
        isPending: conv.isPending,
        unread: conv.unread || 0
      });
    }
  }
  convs.sort((a, b) => b.lastTimestamp - a.lastTimestamp);
  res.json({ conversations: convs });
});

// GET /api/human-agent/pages/:pageId/conversations/:userId
router.get('/pages/:pageId/conversations/:userId', (req, res) => {
  const { pageId, userId } = req.params;
  const conv = getConv(pageId, userId);
  conv.unread = 0; // mark as read
  res.json({
    messages: conv.messages,
    isPending: conv.isPending
  });
});

// POST /api/human-agent/pages/:pageId/conversations/:userId/reply — Human reply
router.post('/pages/:pageId/conversations/:userId/reply', async (req, res) => {
  const { pageId, userId } = req.params;
  const { message, useHumanAgentTag } = req.body;

  if (!message) return res.status(400).json({ error: 'Thiếu nội dung tin nhắn' });

  const page = getPage(pageId);
  if (!page.pageAccessToken) return res.status(400).json({ error: 'Chưa có Page Access Token' });

  try {
    await sendMessengerMessage(page.pageAccessToken, userId, message, useHumanAgentTag);

    const conv = getConv(pageId, userId);
    conv.messages.push({
      role: 'assistant',
      content: message,
      isHuman: true,
      timestamp: Date.now()
    });
    conv.lastMessage = message;
    conv.lastTimestamp = Date.now();

    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/human-agent/pages/:pageId/conversations/:userId/takeover
router.post('/pages/:pageId/conversations/:userId/takeover', (req, res) => {
  const conv = getConv(req.params.pageId, req.params.userId);
  conv.isPending = true;
  res.json({ success: true });
});

// POST /api/human-agent/pages/:pageId/conversations/:userId/release
router.post('/pages/:pageId/conversations/:userId/release', (req, res) => {
  const conv = getConv(req.params.pageId, req.params.userId);
  conv.isPending = false;
  res.json({ success: true });
});

// ═══════════════════════════════════════════════════════
// ROUTES: Test AI
// ═══════════════════════════════════════════════════════
router.post('/pages/:pageId/test', async (req, res) => {
  const { pageId } = req.params;
  const { message } = req.body;
  if (!message) return res.status(400).json({ error: 'Thiếu message' });

  try {
    const { reply, needsHuman } = await generateAIReply(pageId, 'test_user', message);
    res.json({ reply, needsHuman });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ═══════════════════════════════════════════════════════
// ROUTES: Stats
// ═══════════════════════════════════════════════════════
router.get('/stats', (req, res) => {
  const pages = Array.from(store.pages.values());
  const convs = Array.from(store.conversations.values());
  const today = new Date(); today.setHours(0, 0, 0, 0);

  res.json({
    totalPages: pages.length,
    enabledPages: pages.filter(p => p.enabled).length,
    totalConversations: convs.filter(c => c.lastTimestamp >= today.getTime()).length,
    pendingHuman: convs.filter(c => c.isPending).length
  });
});

// ═══════════════════════════════════════════════════════
// WEBHOOK: Facebook Messenger
// ═══════════════════════════════════════════════════════

// GET /api/human-agent/webhook — Verify webhook
router.get('/webhook', (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  const verifyToken = process.env.FB_WEBHOOK_VERIFY_TOKEN || 'genztech_webhook_2024';

  if (mode === 'subscribe' && token === verifyToken) {
    console.log('[HumanAgent] Webhook verified');
    res.status(200).send(challenge);
  } else {
    res.status(403).json({ error: 'Verification failed' });
  }
});

// POST /api/human-agent/webhook — Receive messages
router.post('/webhook', express.json(), async (req, res) => {
  res.status(200).send('EVENT_RECEIVED');

  try {
    const body = req.body;
    if (body.object !== 'page') return;

    for (const entry of (body.entry || [])) {
      const pageId = entry.id;
      const page = store.pages.get(pageId);

      if (!page || !page.enabled) continue;

      for (const event of (entry.messaging || [])) {
        if (!event.message || event.message.is_echo) continue;

        const userId = event.sender.id;
        const text = event.message.text;
        if (!text) continue;

        console.log(`[HumanAgent] Page ${pageId} ← ${userId}: ${text}`);

        // Lưu tin nhắn của user
        const conv = getConv(pageId, userId);
        conv.messages.push({
          role: 'user',
          content: text,
          timestamp: event.timestamp || Date.now()
        });
        conv.lastMessage = text;
        conv.lastTimestamp = event.timestamp || Date.now();
        conv.unread = (conv.unread || 0) + 1;

        // Nếu đang chờ human agent → không tự động trả lời
        if (conv.isPending) {
          console.log(`[HumanAgent] Conv ${userId} is pending human agent, skip AI reply`);
          continue;
        }

        // Generate AI reply
        try {
          const { reply, needsHuman } = await generateAIReply(pageId, userId, text);

          // Gửi reply
          await sendMessengerMessage(page.pageAccessToken, userId, reply);

          // Lưu reply của AI
          conv.messages.push({
            role: 'assistant',
            content: reply,
            isHuman: false,
            timestamp: Date.now()
          });
          conv.lastMessage = reply;
          conv.lastTimestamp = Date.now();

          // Nếu AI không biết → đánh dấu cần human
          if (needsHuman) {
            conv.isPending = true;
            console.log(`[HumanAgent] Conv ${userId} needs human agent`);
          }
        } catch (aiErr) {
          console.error('[HumanAgent] AI error:', aiErr.message);
          // Fallback message
          try {
            await sendMessengerMessage(page.pageAccessToken, userId,
              'Xin lỗi, tôi đang gặp sự cố kỹ thuật. Nhân viên sẽ hỗ trợ bạn sớm nhất.');
            conv.isPending = true;
          } catch {}
        }
      }
    }
  } catch (err) {
    console.error('[HumanAgent] Webhook error:', err.message);
  }
});

module.exports = router;
