/**
 * GenzTech — SQLite Database Module
 * Lưu trữ bền vững: users, fb_tokens, pages
 */
const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

// Đảm bảo thư mục data tồn tại
const DATA_DIR = path.join(__dirname, '../../data');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const DB_PATH = process.env.DB_PATH || path.join(DATA_DIR, 'genztech.db');
const db = new Database(DB_PATH);

// Bật WAL mode để hiệu năng tốt hơn
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// ── Tạo bảng users ──────────────────────────────────────
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    email       TEXT    UNIQUE NOT NULL,
    password    TEXT    NOT NULL,
    -- Facebook info (lấy tự động khi đăng ký)
    fb_user_id   TEXT,
    fb_user_name TEXT,
    fb_avatar    TEXT,
    fb_token     TEXT,
    fb_token_exp TEXT,
    fb_pages     TEXT DEFAULT '[]',   -- JSON array of pages
    -- Meta
    created_at  TEXT DEFAULT (datetime('now')),
    updated_at  TEXT DEFAULT (datetime('now')),
    last_login  TEXT
  );
`);

// ── Prepared Statements ──────────────────────────────────
const userStmt = {
  create: db.prepare(`
    INSERT INTO users (email, password, fb_user_id, fb_user_name, fb_avatar, fb_token, fb_token_exp, fb_pages)
    VALUES (@email, @password, @fb_user_id, @fb_user_name, @fb_avatar, @fb_token, @fb_token_exp, @fb_pages)
  `),

  findByEmail: db.prepare(`SELECT * FROM users WHERE email = ? LIMIT 1`),

  findById: db.prepare(`SELECT * FROM users WHERE id = ? LIMIT 1`),

  updateFbInfo: db.prepare(`
    UPDATE users
    SET fb_user_id = @fb_user_id,
        fb_user_name = @fb_user_name,
        fb_avatar = @fb_avatar,
        fb_token = @fb_token,
        fb_token_exp = @fb_token_exp,
        fb_pages = @fb_pages,
        updated_at = datetime('now')
    WHERE id = @id
  `),

  updateLastLogin: db.prepare(`
    UPDATE users SET last_login = datetime('now') WHERE id = ?
  `),

  updatePassword: db.prepare(`
    UPDATE users SET password = ?, updated_at = datetime('now') WHERE id = ?
  `),
};

module.exports = { db, userStmt };
