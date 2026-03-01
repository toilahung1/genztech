require('dotenv').config();
const express = require('express');

// ── Khởi tạo Prisma (PostgreSQL) ──
const { getPrisma } = require('./db');
try {
  getPrisma();
  console.log('✅ Prisma (PostgreSQL) initialized');
} catch (e) {
  console.error('❌ Prisma init error:', e.message);
}
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');

const authRoutes = require('./api/auth');
const facebookRoutes = require('./api/facebook');
const proxyRoutes = require('./api/proxy');
const postsRoutes = require('./api/posts');
const aiRoutes = require('./api/ai');
const humanAgentRoutes = require('./api/human-agent');
const messagesRoutes   = require('./api/messages');
const { startScheduler } = require('./services/scheduler');

const app = express();
const PORT = process.env.PORT || 3000;

// ── Security Middleware ──
app.use(helmet({ crossOriginResourcePolicy: false }));
app.use(cors({ origin: '*', methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'] }));
app.use(express.json({ limit: '20mb' }));
app.use(express.urlencoded({ extended: true, limit: '20mb' }));

// ── Rate Limiting ──
const limiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 200, standardHeaders: true, legacyHeaders: false });
const authLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 20, message: { error: 'Quá nhiều yêu cầu, vui lòng thử lại sau 15 phút' } });
app.use(limiter);

// ── Health Check ──
app.get('/', (req, res) => res.json({ status: 'ok', service: 'GenzTech API', version: '2.0.0', time: new Date().toISOString() }));
app.get('/health', (req, res) => res.json({ status: 'ok', uptime: Math.floor(process.uptime()) + 's', memory: Math.round(process.memoryUsage().heapUsed / 1024 / 1024) + 'MB' }));

// ── Routes ──
app.use('/api/auth', authLimiter, authRoutes);
app.use('/api/facebook', facebookRoutes);
app.use('/api/facebook/proxy', proxyRoutes);
app.use('/api/proxy', proxyRoutes);
app.use('/api/posts', postsRoutes);
app.use('/api/ai', aiRoutes);
app.use('/api/human-agent', humanAgentRoutes);
app.use('/api/messages', messagesRoutes);

// ── Admin Migration Endpoint (tạm thời) ──
const { execSync } = require('child_process');
app.get('/api/admin/migrate', async (req, res) => {
  if (req.query.secret !== 'GenzMigrate2026') return res.status(403).json({ error: 'Forbidden' });
  try {
    // Bước 1: Chạy raw SQL để thêm cột mới vào bảng hiện tại
    const { PrismaClient } = require('@prisma/client');
    const prisma = new PrismaClient();
    const results = [];
    
    // Bỏ NOT NULL trên cột username (cột cũ không cần nữa)
    try {
      await prisma.$executeRawUnsafe(`ALTER TABLE users ALTER COLUMN username DROP NOT NULL`);
      results.push('Dropped NOT NULL on username');
    } catch(e) { results.push('username nullable: ' + e.message); }
    
    // Set default cho username
    try {
      await prisma.$executeRawUnsafe(`ALTER TABLE users ALTER COLUMN username SET DEFAULT ''`);
      results.push('Set default empty string for username');
    } catch(e) { results.push('username default: ' + e.message); }
    
    // Thêm cột email nếu chưa có
    try {
      await prisma.$executeRawUnsafe(`ALTER TABLE users ADD COLUMN IF NOT EXISTS email TEXT`);
      results.push('Added email column');
    } catch(e) { results.push('email: ' + e.message); }
    
    // Cập nhật email từ username cho các dòng cũ
    try {
      await prisma.$executeRawUnsafe(`UPDATE users SET email = username || '@legacy.local' WHERE email IS NULL OR email = ''`);
      results.push('Updated legacy emails');
    } catch(e) { results.push('update email: ' + e.message); }
    
    // Thêm cột fb_user_id
    try {
      await prisma.$executeRawUnsafe(`ALTER TABLE users ADD COLUMN IF NOT EXISTS "fbUserId" TEXT`);
      results.push('Added fbUserId column');
    } catch(e) { results.push('fbUserId: ' + e.message); }
    
    // Thêm cột fb_user_name
    try {
      await prisma.$executeRawUnsafe(`ALTER TABLE users ADD COLUMN IF NOT EXISTS "fbUserName" TEXT`);
      results.push('Added fbUserName column');
    } catch(e) { results.push('fbUserName: ' + e.message); }
    
    // Thêm cột fb_avatar
    try {
      await prisma.$executeRawUnsafe(`ALTER TABLE users ADD COLUMN IF NOT EXISTS "fbAvatar" TEXT`);
      results.push('Added fbAvatar column');
    } catch(e) { results.push('fbAvatar: ' + e.message); }
    
    // Thêm cột fb_token
    try {
      await prisma.$executeRawUnsafe(`ALTER TABLE users ADD COLUMN IF NOT EXISTS "fbToken" TEXT`);
      results.push('Added fbToken column');
    } catch(e) { results.push('fbToken: ' + e.message); }
    
    // Thêm cột fb_token_exp
    try {
      await prisma.$executeRawUnsafe(`ALTER TABLE users ADD COLUMN IF NOT EXISTS "fbTokenExp" TIMESTAMP`);
      results.push('Added fbTokenExp column');
    } catch(e) { results.push('fbTokenExp: ' + e.message); }
    
    // Thêm cột fb_pages
    try {
      await prisma.$executeRawUnsafe(`ALTER TABLE users ADD COLUMN IF NOT EXISTS "fbPages" TEXT DEFAULT '[]'`);
      results.push('Added fbPages column');
    } catch(e) { results.push('fbPages: ' + e.message); }
    
    // Thêm cột updatedAt
    try {
      await prisma.$executeRawUnsafe(`ALTER TABLE users ADD COLUMN IF NOT EXISTS "updatedAt" TIMESTAMP DEFAULT NOW()`);
      results.push('Added updatedAt column');
    } catch(e) { results.push('updatedAt: ' + e.message); }
    
    // Thêm cột lastLogin
    try {
      await prisma.$executeRawUnsafe(`ALTER TABLE users ADD COLUMN IF NOT EXISTS "lastLogin" TIMESTAMP`);
      results.push('Added lastLogin column');
    } catch(e) { results.push('lastLogin: ' + e.message); }
    
    // Thêm cột createdAt
    try {
      await prisma.$executeRawUnsafe(`ALTER TABLE users ADD COLUMN IF NOT EXISTS "createdAt" TIMESTAMP DEFAULT NOW()`);
      results.push('Added createdAt column');
    } catch(e) { results.push('createdAt: ' + e.message); }
    
    // Tạo unique index cho email
    try {
      await prisma.$executeRawUnsafe(`CREATE UNIQUE INDEX IF NOT EXISTS users_email_key ON users(email)`);
      results.push('Created email unique index');
    } catch(e) { results.push('email index: ' + e.message); }
    
    await prisma.$disconnect();
    res.json({ success: true, results });
  } catch (err) {
    res.json({ success: false, error: err.message });
  }
});

// ── Admin: Tạo bảng conversations và messages ──
app.get('/api/admin/migrate-tables', async (req, res) => {
  if (req.query.secret !== 'GenzMigrate2026') return res.status(403).json({ error: 'Forbidden' });
  try {
    const { PrismaClient } = require('@prisma/client');
    const prisma = new PrismaClient();
    const results = [];

    // Tạo bảng conversations
    try {
      await prisma.$executeRawUnsafe(`
        CREATE TABLE IF NOT EXISTS conversations (
          id               TEXT PRIMARY KEY,
          "pageId"         TEXT NOT NULL,
          "pageName"       TEXT,
          "participantId"  TEXT,
          "participantName" TEXT,
          "participantAvatar" TEXT,
          snippet          TEXT,
          "unreadCount"    INTEGER DEFAULT 0,
          "updatedTime"    TIMESTAMP,
          "canReply"       BOOLEAN DEFAULT true,
          "ownerId"        INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          "fetchedAt"      TIMESTAMP DEFAULT NOW(),
          "createdAt"      TIMESTAMP DEFAULT NOW()
        )
      `);
      results.push('Created conversations table');
    } catch(e) { results.push('conversations: ' + e.message); }

    // Index cho conversations
    try { await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS conv_page_idx ON conversations("pageId")`); results.push('idx: conv_pageId'); } catch(e) {}
    try { await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS conv_owner_idx ON conversations("ownerId")`); results.push('idx: conv_ownerId'); } catch(e) {}

    // Tạo bảng messages
    try {
      await prisma.$executeRawUnsafe(`
        CREATE TABLE IF NOT EXISTS messages (
          id               TEXT PRIMARY KEY,
          "conversationId" TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
          "pageId"         TEXT NOT NULL,
          "fromId"         TEXT,
          "fromName"       TEXT,
          "toId"           TEXT,
          "toName"         TEXT,
          message          TEXT,
          attachments      TEXT DEFAULT '[]',
          "isFromPage"     BOOLEAN DEFAULT false,
          "createdTime"    TIMESTAMP,
          "fetchedAt"      TIMESTAMP DEFAULT NOW()
        )
      `);
      results.push('Created messages table');
    } catch(e) { results.push('messages: ' + e.message); }

    // Index cho messages
    try { await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS msg_conv_idx ON messages("conversationId")`); results.push('idx: msg_conversationId'); } catch(e) {}
    try { await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS msg_page_idx ON messages("pageId")`); results.push('idx: msg_pageId'); } catch(e) {}
    try { await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS msg_time_idx ON messages("createdTime")`); results.push('idx: msg_createdTime'); } catch(e) {}

    await prisma.$disconnect();
    res.json({ success: true, results });
  } catch (err) {
    res.json({ success: false, error: err.message });
  }
});

// ── 404 Handler ──
app.use((req, res) => res.status(404).json({ error: `Route không tồn tại: ${req.method} ${req.path}` }));

// ── Global Error Handler ──
app.use((err, req, res, next) => {
  console.error('[Error]', err.message);
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,PATCH,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization');
  res.status(err.status || 500).json({ error: err.message || 'Lỗi server nội bộ' });
});

// ── Start ──
app.listen(PORT, () => {
  console.log(`✅ GenzTech Backend v2.0 running on port ${PORT}`);
  console.log(`📡 Environment: ${process.env.NODE_ENV || 'development'}`);
  // Start post scheduler
  startScheduler();
});

module.exports = app;
