require('dotenv').config();
const express = require('express');

// ── Khởi tạo SQLite DB ──
try {
  require('./db');
  console.log('✅ SQLite DB initialized');
} catch (e) {
  console.warn('⚠️  SQLite not available, using in-memory store:', e.message);
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
