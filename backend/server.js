/**
 * GenZTech Backend Server
 * Node.js + Express + PostgreSQL + node-cron
 */
require('dotenv').config();

const express   = require('express');
const cors      = require('cors');
const helmet    = require('helmet');
const morgan    = require('morgan');
const rateLimit = require('express-rate-limit');

// ============================================================
//  Khởi tạo Express app
// ============================================================
const app = express();

app.set('trust proxy', 1);

// Security headers
app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } }));

// CORS
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
app.use('/api/', rateLimit({
  windowMs: 60 * 1000, max: 100,
  message: { error: 'Quá nhiều request, vui lòng thử lại sau' },
}));
app.use('/api/auth/', rateLimit({
  windowMs: 60 * 1000, max: 10,
  message: { error: 'Quá nhiều lần đăng nhập, vui lòng thử lại sau 1 phút' },
}));
app.use('/api/ai/', rateLimit({
  windowMs: 60 * 1000, max: 20,
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
    version:   '2.0.0',
    db:        'postgresql',
    service:   'GenZTech API',
    timestamp: new Date().toISOString(),
    uptime:    Math.floor(process.uptime()) + 's',
  });
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
//  Khởi động Server
// ============================================================
const PORT = process.env.PORT || 3001;

async function startServer() {
  try {
    // Khởi tạo database (tạo bảng nếu chưa có)
    const { initSchema } = require('./database');
    await initSchema();
    console.log('[DB] PostgreSQL connected and tables ready');

    app.listen(PORT, () => {
      console.log('');
      console.log('╔══════════════════════════════════════════╗');
      console.log('║     GenZTech Backend Server v2.0.0       ║');
      console.log('╠══════════════════════════════════════════╣');
      console.log(`║  Port:    ${PORT}                              ║`);
      console.log(`║  Mode:    ${(process.env.NODE_ENV || 'development').padEnd(32)}║`);
      console.log(`║  DB:      PostgreSQL                         ║`);
      console.log('╚══════════════════════════════════════════╝');
      console.log('');

      // Khởi động scheduler
      const { startScheduler } = require('./scheduler');
      startScheduler();
    });
  } catch (err) {
    console.error('[FATAL] Cannot start server:', err.message);
    process.exit(1);
  }
}

startServer();

module.exports = app;
