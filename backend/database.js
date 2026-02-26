/**
 * GenZTech Backend — Database Layer (PostgreSQL via pg)
 * Lưu trữ: users, facebook_tokens, pages, scheduled_posts, post_history
 */
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
  max: 10,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
});

pool.on('error', (err) => console.error('[DB] Pool error:', err.message));

// ============================================================
//  SCHEMA
// ============================================================
async function initSchema() {
  const client = await pool.connect();
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        username TEXT UNIQUE NOT NULL,
        password TEXT NOT NULL,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        last_login TIMESTAMPTZ
      );
      CREATE TABLE IF NOT EXISTS facebook_tokens (
        id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        fb_user_id TEXT NOT NULL,
        fb_user_name TEXT,
        fb_user_picture TEXT,
        short_token TEXT,
        long_token TEXT NOT NULL,
        long_token_expires TIMESTAMPTZ,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW(),
        UNIQUE(user_id, fb_user_id)
      );
      CREATE TABLE IF NOT EXISTS facebook_pages (
        id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        fb_token_id INTEGER NOT NULL REFERENCES facebook_tokens(id) ON DELETE CASCADE,
        page_id TEXT NOT NULL,
        page_name TEXT NOT NULL,
        page_token TEXT NOT NULL,
        page_picture TEXT,
        category TEXT,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW(),
        UNIQUE(user_id, page_id)
      );
      CREATE TABLE IF NOT EXISTS scheduled_posts (
        id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        page_id TEXT NOT NULL,
        page_name TEXT,
        content TEXT NOT NULL,
        image_url TEXT,
        link_url TEXT,
        post_type TEXT DEFAULT 'feed',
        scheduled_at TIMESTAMPTZ NOT NULL,
        repeat_type TEXT DEFAULT 'none',
        status TEXT DEFAULT 'pending',
        fb_post_id TEXT,
        error_msg TEXT,
        retry_count INTEGER DEFAULT 0,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      );
      CREATE TABLE IF NOT EXISTS post_history (
        id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        page_id TEXT NOT NULL,
        page_name TEXT,
        content TEXT NOT NULL,
        fb_post_id TEXT,
        status TEXT NOT NULL,
        error_msg TEXT,
        posted_at TIMESTAMPTZ DEFAULT NOW()
      );
      CREATE TABLE IF NOT EXISTS token_refresh_log (
        id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL,
        fb_user_id TEXT NOT NULL,
        action TEXT NOT NULL,
        success BOOLEAN DEFAULT TRUE,
        message TEXT,
        created_at TIMESTAMPTZ DEFAULT NOW()
      );
    `);
    console.log('[DB] PostgreSQL schema initialized');
  } finally {
    client.release();
  }
}

// ============================================================
//  HELPERS — async functions (thay vì better-sqlite3 sync)
// ============================================================

const userStmt = {
  findByUsername: (username) =>
    pool.query('SELECT * FROM users WHERE username = $1', [username]).then(r => r.rows[0] || null),
  findById: (id) =>
    pool.query('SELECT * FROM users WHERE id = $1', [id]).then(r => r.rows[0] || null),
  create: (username, password) =>
    pool.query('INSERT INTO users (username, password) VALUES ($1, $2) RETURNING id', [username, password]).then(r => r.rows[0]),
  updateLogin: (id) =>
    pool.query('UPDATE users SET last_login = NOW() WHERE id = $1', [id]),
};

const tokenStmt = {
  upsert: ({ user_id, fb_user_id, fb_user_name, fb_user_picture, short_token, long_token, long_token_expires }) =>
    pool.query(
      `INSERT INTO facebook_tokens (user_id, fb_user_id, fb_user_name, fb_user_picture, short_token, long_token, long_token_expires)
       VALUES ($1,$2,$3,$4,$5,$6,$7)
       ON CONFLICT(user_id, fb_user_id) DO UPDATE SET
         fb_user_name = EXCLUDED.fb_user_name,
         fb_user_picture = EXCLUDED.fb_user_picture,
         short_token = EXCLUDED.short_token,
         long_token = EXCLUDED.long_token,
         long_token_expires = EXCLUDED.long_token_expires,
         updated_at = NOW()
       RETURNING *`,
      [user_id, fb_user_id, fb_user_name, fb_user_picture, short_token, long_token, long_token_expires]
    ).then(r => r.rows[0]),

  findByUser: (user_id) =>
    pool.query('SELECT * FROM facebook_tokens WHERE user_id = $1 ORDER BY updated_at DESC LIMIT 1', [user_id]).then(r => r.rows[0] || null),
  findAll: (user_id) =>
    pool.query('SELECT * FROM facebook_tokens WHERE user_id = $1', [user_id]).then(r => r.rows),
  updateLong: (long_token, long_token_expires, user_id, fb_user_id) =>
    pool.query(
      'UPDATE facebook_tokens SET long_token=$1, long_token_expires=$2, updated_at=NOW() WHERE user_id=$3 AND fb_user_id=$4',
      [long_token, long_token_expires, user_id, fb_user_id]
    ),
  delete: (user_id, fb_user_id) =>
    pool.query('DELETE FROM facebook_tokens WHERE user_id=$1 AND fb_user_id=$2', [user_id, fb_user_id]),
  findAllExpiring: (days) =>
    pool.query(
      `SELECT * FROM facebook_tokens WHERE long_token_expires IS NOT NULL AND long_token_expires < NOW() + ($1 || ' days')::INTERVAL`,
      [days]
    ).then(r => r.rows),
};

const pageStmt = {
  upsert: ({ user_id, fb_token_id, page_id, page_name, page_token, page_picture, category }) =>
    pool.query(
      `INSERT INTO facebook_pages (user_id, fb_token_id, page_id, page_name, page_token, page_picture, category)
       VALUES ($1,$2,$3,$4,$5,$6,$7)
       ON CONFLICT(user_id, page_id) DO UPDATE SET
         page_name = EXCLUDED.page_name,
         page_token = EXCLUDED.page_token,
         page_picture = EXCLUDED.page_picture,
         category = EXCLUDED.category,
         updated_at = NOW()
       RETURNING *`,
      [user_id, fb_token_id, page_id, page_name, page_token, page_picture, category]
    ).then(r => r.rows[0]),
  findByUser: (user_id) =>
    pool.query('SELECT * FROM facebook_pages WHERE user_id=$1 ORDER BY page_name', [user_id]).then(r => r.rows),
  findByPageId: (user_id, page_id) =>
    pool.query('SELECT * FROM facebook_pages WHERE user_id=$1 AND page_id=$2', [user_id, page_id]).then(r => r.rows[0] || null),
};

const schedStmt = {
  create: ({ user_id, page_id, page_name, content, image_url, link_url, post_type, scheduled_at, repeat_type }) =>
    pool.query(
      `INSERT INTO scheduled_posts (user_id, page_id, page_name, content, image_url, link_url, post_type, scheduled_at, repeat_type)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
      [user_id, page_id, page_name, content, image_url, link_url, post_type || 'feed', scheduled_at, repeat_type || 'none']
    ).then(r => r.rows[0]),
  findPending: () =>
    pool.query("SELECT * FROM scheduled_posts WHERE status='pending' AND scheduled_at <= NOW()").then(r => r.rows),
  findByUser: (user_id) =>
    pool.query('SELECT * FROM scheduled_posts WHERE user_id=$1 ORDER BY scheduled_at DESC', [user_id]).then(r => r.rows),
  findPendingByUser: (user_id) =>
    pool.query("SELECT * FROM scheduled_posts WHERE user_id=$1 AND status='pending' ORDER BY scheduled_at", [user_id]).then(r => r.rows),
  updateStatus: (status, fb_post_id, error_msg, id) =>
    pool.query(
      'UPDATE scheduled_posts SET status=$1, fb_post_id=$2, error_msg=$3, retry_count=retry_count+1, updated_at=NOW() WHERE id=$4',
      [status, fb_post_id, error_msg, id]
    ),
  cancel: (id, user_id) =>
    pool.query("UPDATE scheduled_posts SET status='cancelled', updated_at=NOW() WHERE id=$1 AND user_id=$2", [id, user_id]),
  delete: (id, user_id) =>
    pool.query('DELETE FROM scheduled_posts WHERE id=$1 AND user_id=$2', [id, user_id]),
};

const histStmt = {
  create: ({ user_id, page_id, page_name, content, fb_post_id, status, error_msg }) =>
    pool.query(
      'INSERT INTO post_history (user_id, page_id, page_name, content, fb_post_id, status, error_msg) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *',
      [user_id, page_id, page_name, content, fb_post_id, status, error_msg]
    ).then(r => r.rows[0]),
  findByUser: (user_id) =>
    pool.query('SELECT * FROM post_history WHERE user_id=$1 ORDER BY posted_at DESC LIMIT 100', [user_id]).then(r => r.rows),
  findByStatus: (user_id, status) =>
    pool.query('SELECT * FROM post_history WHERE user_id=$1 AND status=$2 ORDER BY posted_at DESC LIMIT 50', [user_id, status]).then(r => r.rows),
};

const logStmt = {
  create: (user_id, fb_user_id, action, success, message) =>
    pool.query(
      'INSERT INTO token_refresh_log (user_id, fb_user_id, action, success, message) VALUES ($1,$2,$3,$4,$5)',
      [user_id, fb_user_id, action, success, message]
    ),
  findByUser: (user_id, limit = 20) =>
    pool.query('SELECT * FROM token_refresh_log WHERE user_id=$1 ORDER BY created_at DESC LIMIT $2', [user_id, limit]).then(r => r.rows),
};

module.exports = { pool, initSchema, userStmt, tokenStmt, pageStmt, schedStmt, histStmt, logStmt };
