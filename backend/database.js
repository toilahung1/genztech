/**
 * GenZTech Backend — Database Layer (SQLite via better-sqlite3)
 * Lưu trữ: users, facebook_tokens, pages, scheduled_posts, post_history
 */

const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const dbDir = path.dirname(process.env.DB_PATH || './data/genztech.db');
if (!fs.existsSync(dbDir)) fs.mkdirSync(dbDir, { recursive: true });

const db = new Database(process.env.DB_PATH || './data/genztech.db');

// WAL mode — tốt hơn cho concurrent reads
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// ============================================================
//  SCHEMA
// ============================================================
db.exec(`
  -- Bảng người dùng hệ thống (đăng nhập vào GenZTech)
  CREATE TABLE IF NOT EXISTS users (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    username    TEXT    UNIQUE NOT NULL,
    password    TEXT    NOT NULL,
    created_at  TEXT    DEFAULT (datetime('now')),
    last_login  TEXT
  );

  -- Bảng lưu Facebook Token (mã hóa)
  CREATE TABLE IF NOT EXISTS facebook_tokens (
    id                  INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id             INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    fb_user_id          TEXT    NOT NULL,
    fb_user_name        TEXT,
    fb_user_picture     TEXT,
    short_token         TEXT,
    long_token          TEXT    NOT NULL,
    long_token_expires  TEXT,   -- ISO datetime
    created_at          TEXT    DEFAULT (datetime('now')),
    updated_at          TEXT    DEFAULT (datetime('now')),
    UNIQUE(user_id, fb_user_id)
  );

  -- Bảng lưu Facebook Pages
  CREATE TABLE IF NOT EXISTS facebook_pages (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id         INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    fb_token_id     INTEGER NOT NULL REFERENCES facebook_tokens(id) ON DELETE CASCADE,
    page_id         TEXT    NOT NULL,
    page_name       TEXT    NOT NULL,
    page_token      TEXT    NOT NULL,  -- Page token KHÔNG hết hạn
    page_picture    TEXT,
    category        TEXT,
    created_at      TEXT    DEFAULT (datetime('now')),
    updated_at      TEXT    DEFAULT (datetime('now')),
    UNIQUE(user_id, page_id)
  );

  -- Bảng bài viết đã lên lịch
  CREATE TABLE IF NOT EXISTS scheduled_posts (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    page_id     TEXT    NOT NULL,
    page_name   TEXT,
    content     TEXT    NOT NULL,
    image_url   TEXT,
    link_url    TEXT,
    post_type   TEXT    DEFAULT 'feed',
    scheduled_at TEXT   NOT NULL,  -- ISO datetime
    repeat_type TEXT    DEFAULT 'none',  -- none | daily | weekly | monthly
    status      TEXT    DEFAULT 'pending',  -- pending | posted | failed | cancelled
    fb_post_id  TEXT,
    error_msg   TEXT,
    retry_count INTEGER DEFAULT 0,
    created_at  TEXT    DEFAULT (datetime('now')),
    updated_at  TEXT    DEFAULT (datetime('now'))
  );

  -- Bảng lịch sử đăng bài
  CREATE TABLE IF NOT EXISTS post_history (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    page_id     TEXT    NOT NULL,
    page_name   TEXT,
    content     TEXT    NOT NULL,
    fb_post_id  TEXT,
    status      TEXT    NOT NULL,  -- posted | failed
    error_msg   TEXT,
    posted_at   TEXT    DEFAULT (datetime('now'))
  );

  -- Bảng token refresh log
  CREATE TABLE IF NOT EXISTS token_refresh_log (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id     INTEGER NOT NULL,
    fb_user_id  TEXT    NOT NULL,
    action      TEXT    NOT NULL,  -- refresh | exchange | revoke
    success     INTEGER DEFAULT 1,
    message     TEXT,
    created_at  TEXT    DEFAULT (datetime('now'))
  );
`);

// ============================================================
//  HELPERS
// ============================================================

// Users
const userStmt = {
  findByUsername: db.prepare('SELECT * FROM users WHERE username = ?'),
  findById:       db.prepare('SELECT * FROM users WHERE id = ?'),
  create:         db.prepare('INSERT INTO users (username, password) VALUES (?, ?)'),
  updateLogin:    db.prepare("UPDATE users SET last_login = datetime('now') WHERE id = ?"),
};

// Facebook Tokens
const tokenStmt = {
  upsert: db.prepare(`
    INSERT INTO facebook_tokens (user_id, fb_user_id, fb_user_name, fb_user_picture, short_token, long_token, long_token_expires)
    VALUES (@user_id, @fb_user_id, @fb_user_name, @fb_user_picture, @short_token, @long_token, @long_token_expires)
    ON CONFLICT(user_id, fb_user_id) DO UPDATE SET
      fb_user_name       = excluded.fb_user_name,
      fb_user_picture    = excluded.fb_user_picture,
      short_token        = excluded.short_token,
      long_token         = excluded.long_token,
      long_token_expires = excluded.long_token_expires,
      updated_at         = datetime('now')
  `),
  findByUser:    db.prepare('SELECT * FROM facebook_tokens WHERE user_id = ? ORDER BY updated_at DESC LIMIT 1'),
  findAll:       db.prepare('SELECT * FROM facebook_tokens WHERE user_id = ?'),
  updateLong:    db.prepare(`
    UPDATE facebook_tokens SET long_token = ?, long_token_expires = ?, updated_at = datetime('now')
    WHERE user_id = ? AND fb_user_id = ?
  `),
  delete:        db.prepare('DELETE FROM facebook_tokens WHERE user_id = ? AND fb_user_id = ?'),
};

// Pages
const pageStmt = {
  upsert: db.prepare(`
    INSERT INTO facebook_pages (user_id, fb_token_id, page_id, page_name, page_token, page_picture, category)
    VALUES (@user_id, @fb_token_id, @page_id, @page_name, @page_token, @page_picture, @category)
    ON CONFLICT(user_id, page_id) DO UPDATE SET
      page_name    = excluded.page_name,
      page_token   = excluded.page_token,
      page_picture = excluded.page_picture,
      category     = excluded.category,
      updated_at   = datetime('now')
  `),
  findByUser:  db.prepare('SELECT * FROM facebook_pages WHERE user_id = ? ORDER BY page_name'),
  findByPageId: db.prepare('SELECT * FROM facebook_pages WHERE user_id = ? AND page_id = ?'),
};

// Scheduled Posts
const schedStmt = {
  create: db.prepare(`
    INSERT INTO scheduled_posts (user_id, page_id, page_name, content, image_url, link_url, post_type, scheduled_at, repeat_type)
    VALUES (@user_id, @page_id, @page_name, @content, @image_url, @link_url, @post_type, @scheduled_at, @repeat_type)
  `),
  findPending:  db.prepare("SELECT * FROM scheduled_posts WHERE status = 'pending' AND scheduled_at <= datetime('now')"),
  findByUser:   db.prepare("SELECT * FROM scheduled_posts WHERE user_id = ? ORDER BY scheduled_at DESC"),
  findPendingByUser: db.prepare("SELECT * FROM scheduled_posts WHERE user_id = ? AND status = 'pending' ORDER BY scheduled_at"),
  updateStatus: db.prepare(`
    UPDATE scheduled_posts SET status = ?, fb_post_id = ?, error_msg = ?, retry_count = retry_count + 1, updated_at = datetime('now')
    WHERE id = ?
  `),
  cancel:       db.prepare("UPDATE scheduled_posts SET status = 'cancelled', updated_at = datetime('now') WHERE id = ? AND user_id = ?"),
  delete:       db.prepare('DELETE FROM scheduled_posts WHERE id = ? AND user_id = ?'),
};

// Post History
const histStmt = {
  create: db.prepare(`
    INSERT INTO post_history (user_id, page_id, page_name, content, fb_post_id, status, error_msg)
    VALUES (@user_id, @page_id, @page_name, @content, @fb_post_id, @status, @error_msg)
  `),
  findByUser: db.prepare('SELECT * FROM post_history WHERE user_id = ? ORDER BY posted_at DESC LIMIT 100'),
  findByStatus: db.prepare("SELECT * FROM post_history WHERE user_id = ? AND status = ? ORDER BY posted_at DESC LIMIT 50"),
};

// Token Refresh Log
const logStmt = {
  create: db.prepare(`
    INSERT INTO token_refresh_log (user_id, fb_user_id, action, success, message)
    VALUES (?, ?, ?, ?, ?)
  `),
};

module.exports = { db, userStmt, tokenStmt, pageStmt, schedStmt, histStmt, logStmt };
