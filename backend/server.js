/**
 * GenZTech Backend Server
 * Node.js + Express + SQLite + node-cron
 *
 * Chạy: node server.js
 * Production: pm2 start server.js --name genztech-api
 */

require('dotenv').config();

const express    = require('express');
const cors       = require('cors');
const helmet     = require('helmet');
const morgan     = require('morgan');
const rateLimit  = require('express-rate-limit');
const path       = require('path');

// ============================================================
//  Khởi tạo database (tạo bảng nếu chưa có)
// ============================================================
require('./database');

// ============================================================
//  Khởi tạo Express app
// ============================================================
const app = express();

// Security headers
app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } }));

// CORS — cho phép frontend GitHub Pages
const allowedOrigins = [
  process.env.FRONTEND_URL || 'https://toilahung1.github.io',
  'http://localhost:3000',
  'http://localhost:5500',
  'http://127.0.0.1:5500',
];
app.use(cors({
  origin: (origin, cb) => {
    if (!origin || allowedOrigins.some(o => origin.startsWith(o))) return cb(null, true);
    cb(new Error('CORS not allowed: ' + origin));
  },
  credentials: true,
}));

// Body parsing
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Logging
if (process.env.NODE_ENV !== 'test') {
  app.use(morgan('[:date[clf]] :method :url :status :response-time ms'));
}

// ============================================================
//  Rate Limiting
// ============================================================
// Giới hạn chung: 100 req/phút
app.use('/api/', rateLimit({
  windowMs: 60 * 1000,
  max: 100,
  message: { error: 'Quá nhiều request, vui lòng thử lại sau' },
}));

// Giới hạn auth: 10 req/phút (chống brute force)
app.use('/api/auth/', rateLimit({
  windowMs: 60 * 1000,
  max: 10,
  message: { error: 'Quá nhiều lần đăng nhập, vui lòng thử lại sau 1 phút' },
}));

// Giới hạn AI: 20 req/phút (tránh lạm dụng OpenAI)
app.use('/api/ai/', rateLimit({
  windowMs: 60 * 1000,
  max: 20,
  message: { error: 'Giới hạn AI: tối đa 20 request/phút' },
}));

// ============================================================
//  Routes
// ============================================================
app.use('/api/auth',     require('./routes/auth'));
app.use('/api/facebook', require('./routes/facebook'));
app.use('/api/posts',    require('./routes/posts'));
app.use('/api/ai',       require('./routes/ai'));

// ============================================================
//  Health Check
// ============================================================
app.get('/health', (req, res) => {
  res.json({
    status:    'ok',
    version:   '1.0.0',
    service:   'GenZTech API',
    timestamp: new Date().toISOString(),
    uptime:    Math.floor(process.uptime()) + 's',
  });
});

// GET /api/token-status — public endpoint kiểm tra token sắp hết hạn
app.get('/api/token-status', (req, res) => {
  const { db } = require('./database');
  const expiring = db.prepare(`
    SELECT fb_user_name, long_token_expires,
           CAST((julianday(long_token_expires) - julianday('now')) AS INTEGER) as days_left
    FROM facebook_tokens
    WHERE long_token_expires IS NOT NULL
      AND long_token_expires < datetime('now', '+15 days')
  `).all();
  res.json({ expiring_soon: expiring.length, tokens: expiring });
});

// ============================================================
//  404 Handler
// ============================================================
app.use((req, res) => {
  res.status(404).json({ error: `Route không tồn tại: ${req.method} ${req.path}` });
});

// ============================================================
//  Error Handler
// ============================================================
app.use((err, req, res, next) => {
  console.error('[Error]', err.message);
  res.status(500).json({ error: 'Internal server error', detail: err.message });
});

// ============================================================
//  Khởi động Server + Scheduler
// ============================================================
const PORT = process.env.PORT || 3001;

app.listen(PORT, () => {
  console.log('');
  console.log('╔══════════════════════════════════════════╗');
  console.log('║     GenZTech Backend Server v1.0.0       ║');
  console.log('╠══════════════════════════════════════════╣');
  console.log(`║  Port:    ${PORT}                              ║`);
  console.log(`║  Mode:    ${(process.env.NODE_ENV || 'development').padEnd(32)}║`);
  console.log(`║  DB:      ${(process.env.DB_PATH || './data/genztech.db').padEnd(32)}║`);
  console.log('╚══════════════════════════════════════════╝');
  console.log('');

  // Khởi động scheduler
  const { startScheduler } = require('./scheduler');
  startScheduler();
});

module.exports = app;
