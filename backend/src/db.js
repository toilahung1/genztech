/**
 * GenzTech — Database Module (Prisma + PostgreSQL)
 * id: Int (autoincrement), fbPages: String (JSON text)
 */
const { PrismaClient } = require('@prisma/client');

let prisma;

function getPrisma() {
  if (!prisma) {
    prisma = new PrismaClient({
      log: process.env.NODE_ENV === 'development' ? ['error', 'warn'] : ['error'],
    });
  }
  return prisma;
}

// ── Chuyển đổi Prisma format sang format tương thích với auth.js ──
function _toCompat(user) {
  if (!user) return null;
  return {
    id: user.id,                          // Int
    email: user.email,
    password: user.password,
    fb_user_id: user.fbUserId || null,
    fb_user_name: user.fbUserName || null,
    fb_avatar: user.fbAvatar || null,
    fb_token: user.fbToken || null,
    fb_token_exp: user.fbTokenExp ? user.fbTokenExp.toISOString() : null,
    fb_pages: user.fbPages || '[]',       // String
    created_at: user.createdAt ? user.createdAt.toISOString() : null,
    last_login: user.lastLogin ? user.lastLogin.toISOString() : null,
  };
}

// ── userStmt: API tương thích với code auth.js hiện tại ──
const userStmt = {
  create: {
    run: async (data) => {
      const db = getPrisma();
      const created = await db.user.create({
        data: {
          email: data.email,
          password: data.password,
          fbUserId: data.fb_user_id || null,
          fbUserName: data.fb_user_name || null,
          fbAvatar: data.fb_avatar || null,
          fbToken: data.fb_token || null,
          fbTokenExp: data.fb_token_exp ? new Date(data.fb_token_exp) : null,
          fbPages: data.fb_pages || '[]',   // String
        },
      });
      return { lastInsertRowid: created.id };
    },
  },

  findByEmail: {
    get: async (email) => {
      const db = getPrisma();
      const user = await db.user.findUnique({ where: { email } });
      return _toCompat(user);
    },
  },

  findById: {
    get: async (id) => {
      const db = getPrisma();
      const user = await db.user.findUnique({ where: { id: Number(id) } });  // Int
      return _toCompat(user);
    },
  },

  updateFbInfo: {
    run: async (data) => {
      const db = getPrisma();
      return db.user.update({
        where: { id: Number(data.id) },  // Int
        data: {
          fbUserId: data.fb_user_id || null,
          fbUserName: data.fb_user_name || null,
          fbAvatar: data.fb_avatar || null,
          fbToken: data.fb_token || null,
          fbTokenExp: data.fb_token_exp ? new Date(data.fb_token_exp) : null,
          fbPages: data.fb_pages || '[]',  // String
        },
      });
    },
  },

  updateLastLogin: {
    run: async (id) => {
      const db = getPrisma();
      return db.user.update({
        where: { id: Number(id) },  // Int
        data: { lastLogin: new Date() },
      });
    },
  },

  updatePassword: {
    run: async (password, id) => {
      const db = getPrisma();
      return db.user.update({
        where: { id: Number(id) },  // Int
        data: { password },
      });
    },
  },
};

module.exports = { getPrisma, userStmt };
