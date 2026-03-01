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

// ── Admin Migration Endpoint (tạm thời) ──
const { execSync } = require('child_process');
app.get('/api/admin/migrate', async (req, res) => {
  if (req.query.secret !== 'GenzMigrate2026') return res.status(403).json({ error: 'Forbidden' });
  try {
    const output = execSync('npx prisma db push --accept-data-loss', {
      cwd: process.cwd(),
      timeout: 90000,
      env: { ...process.env }
    }).toString();
    res.json({ success: true, output });
  } catch (err) {
    res.json({ success: false, error: err.message, stdout: err.stdout?.toString(), stderr: err.stderr?.toString() });
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
