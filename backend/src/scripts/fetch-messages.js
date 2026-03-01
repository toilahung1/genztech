/**
 * GenzTech — Fetch Messages Script
 * Lấy toàn bộ tin nhắn từ tất cả Pages của 1 user và lưu vào PostgreSQL
 *
 * Cách dùng:
 *   node src/scripts/fetch-messages.js --email=trandonghung290702@gmail.com
 *   node src/scripts/fetch-messages.js --email=trandonghung290702@gmail.com --days=30
 *   node src/scripts/fetch-messages.js --email=trandonghung290702@gmail.com --page=<PAGE_ID>
 */

require('dotenv').config();
const axios = require('axios');
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();
const FB_GRAPH = 'https://graph.facebook.com/v19.0';

// ── Parse CLI args ────────────────────────────────────────────
const args = Object.fromEntries(
  process.argv.slice(2)
    .filter(a => a.startsWith('--'))
    .map(a => {
      const [k, v] = a.slice(2).split('=');
      return [k, v || true];
    })
);

const TARGET_EMAIL = args.email;
const DAYS_BACK    = parseInt(args.days || '90');
const ONLY_PAGE    = args.page || null;  // Lọc theo page ID cụ thể

if (!TARGET_EMAIL) {
  console.error('❌ Thiếu --email. Ví dụ: node fetch-messages.js --email=user@gmail.com');
  process.exit(1);
}

// ── Helper: Gọi FB Graph API với retry ───────────────────────
async function fbGet(path, params = {}, retries = 3) {
  for (let i = 0; i < retries; i++) {
    try {
      const res = await axios.get(`${FB_GRAPH}${path}`, {
        params,
        timeout: 30000,
      });
      return res.data;
    } catch (err) {
      const fbErr = err.response?.data?.error;
      if (fbErr?.code === 190) throw new Error(`Token hết hạn: ${fbErr.message}`);
      if (fbErr?.code === 10 || fbErr?.code === 200) throw new Error(`Không có quyền: ${fbErr.message}`);
      if (i === retries - 1) throw err;
      await sleep(2000 * (i + 1));
    }
  }
}

// ── Helper: Lấy tất cả trang (pagination) ────────────────────
async function fetchAllPages(initialUrl, params = {}, maxPages = 50) {
  const results = [];
  let url = initialUrl;
  let page = 0;

  while (url && page < maxPages) {
    const data = await fbGet(url.replace(FB_GRAPH, ''), params);
    if (data.data) results.push(...data.data);
    url = data.paging?.next || null;
    params = {};  // Clear params sau lần đầu (URL đã có params)
    page++;
    if (data.data?.length === 0) break;
    await sleep(300);  // Rate limit
  }
  return results;
}

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

function log(msg, indent = 0) {
  const prefix = '  '.repeat(indent);
  console.log(`${prefix}${msg}`);
}

// ── Main ──────────────────────────────────────────────────────
async function main() {
  console.log('═══════════════════════════════════════════════════');
  console.log('  GenzTech — Fetch Messages');
  console.log(`  Email: ${TARGET_EMAIL}`);
  console.log(`  Days back: ${DAYS_BACK}`);
  if (ONLY_PAGE) console.log(`  Filter page: ${ONLY_PAGE}`);
  console.log('═══════════════════════════════════════════════════\n');

  // 1. Lấy thông tin user từ DB
  log('📋 Đang tìm user trong database...');
  const user = await prisma.user.findUnique({
    where: { email: TARGET_EMAIL.toLowerCase().trim() },
  });

  if (!user) {
    console.error(`❌ Không tìm thấy user với email: ${TARGET_EMAIL}`);
    process.exit(1);
  }

  log(`✅ Tìm thấy user: ${user.fbUserName || user.email} (ID: ${user.id})`);

  if (!user.fbToken) {
    console.error('❌ User chưa kết nối Facebook (fbToken trống)');
    process.exit(1);
  }

  // 2. Lấy danh sách Pages
  log('\n📄 Đang lấy danh sách Pages...');
  let pages = [];
  try {
    pages = JSON.parse(user.fbPages || '[]');
  } catch {}

  if (!pages.length) {
    log('  Không có pages trong DB, đang gọi FB API...');
    try {
      const pagesData = await fbGet('/me/accounts', {
        fields: 'id,name,access_token,category',
        limit: 200,
        access_token: user.fbToken,
      });
      pages = pagesData.data || [];
    } catch (err) {
      console.error(`❌ Không thể lấy pages: ${err.message}`);
      process.exit(1);
    }
  }

  if (ONLY_PAGE) {
    pages = pages.filter(p => p.id === ONLY_PAGE);
    if (!pages.length) {
      console.error(`❌ Không tìm thấy page ID: ${ONLY_PAGE}`);
      process.exit(1);
    }
  }

  log(`✅ Tìm thấy ${pages.length} Pages\n`);

  // Thống kê
  let totalConversations = 0;
  let totalMessages = 0;
  let totalNew = 0;
  let totalUpdated = 0;

  const sinceDate = new Date(Date.now() - DAYS_BACK * 24 * 60 * 60 * 1000);

  // 3. Duyệt từng Page
  for (const page of pages) {
    const pageToken = page.access_token;
    const pageId    = page.id;
    const pageName  = page.name;

    if (!pageToken) {
      log(`⚠️  Bỏ qua "${pageName}" — không có page token`, 1);
      continue;
    }

    log(`📌 Page: ${pageName} (${pageId})`);

    // 3a. Lấy danh sách conversations
    let conversations = [];
    try {
      conversations = await fetchAllPages(`/${pageId}/conversations`, {
        fields: 'id,snippet,updated_time,unread_count,can_reply,participants',
        limit: 100,
        access_token: pageToken,
      }, 20);
    } catch (err) {
      log(`  ⚠️  Không thể lấy conversations: ${err.message}`, 1);
      continue;
    }

    log(`  → ${conversations.length} conversations`, 1);
    totalConversations += conversations.length;

    // 3b. Duyệt từng conversation
    for (const conv of conversations) {
      const convUpdated = new Date(conv.updated_time);
      if (convUpdated < sinceDate) continue;  // Bỏ qua conv quá cũ

      // Lấy thông tin participant (người dùng, không phải Page)
      const participants = conv.participants?.data || [];
      const participant  = participants.find(p => p.id !== pageId) || participants[0];

      // Upsert conversation vào DB
      await prisma.conversation.upsert({
        where: { id: conv.id },
        create: {
          id:               conv.id,
          pageId:           pageId,
          pageName:         pageName,
          participantId:    participant?.id || null,
          participantName:  participant?.name || null,
          snippet:          conv.snippet || null,
          unreadCount:      conv.unread_count || 0,
          updatedTime:      convUpdated,
          canReply:         conv.can_reply !== false,
          ownerId:          user.id,
        },
        update: {
          snippet:      conv.snippet || null,
          unreadCount:  conv.unread_count || 0,
          updatedTime:  convUpdated,
          canReply:     conv.can_reply !== false,
          fetchedAt:    new Date(),
        },
      });

      // 3c. Lấy tất cả messages trong conversation
      let messages = [];
      try {
        messages = await fetchAllPages(`/${conv.id}/messages`, {
          fields: 'id,from,to,message,attachments,created_time',
          limit: 100,
          access_token: pageToken,
        }, 30);
      } catch (err) {
        log(`    ⚠️  Conv ${conv.id}: ${err.message}`, 2);
        continue;
      }

      totalMessages += messages.length;

      // 3d. Upsert từng message
      for (const msg of messages) {
        const fromId   = msg.from?.id || null;
        const fromName = msg.from?.name || null;
        const toEntry  = msg.to?.data?.[0] || null;
        const toId     = toEntry?.id || null;
        const toName   = toEntry?.name || null;
        const isFromPage = fromId === pageId;
        const attachments = msg.attachments?.data
          ? JSON.stringify(msg.attachments.data)
          : '[]';

        try {
          const result = await prisma.message.upsert({
            where: { id: msg.id },
            create: {
              id:             msg.id,
              conversationId: conv.id,
              pageId:         pageId,
              fromId,
              fromName,
              toId,
              toName,
              message:        msg.message || null,
              attachments,
              isFromPage,
              createdTime:    msg.created_time ? new Date(msg.created_time) : null,
            },
            update: {
              message:     msg.message || null,
              attachments,
              fetchedAt:   new Date(),
            },
          });
          // Prisma upsert không phân biệt create/update dễ dàng, đếm tổng
          totalNew++;
        } catch (e) {
          // Bỏ qua lỗi duplicate
          if (!e.message.includes('Unique constraint')) {
            log(`    ⚠️  Msg ${msg.id}: ${e.message}`, 3);
          }
        }
      }

      await sleep(200);  // Rate limit giữa các conversations
    }

    log(`  ✅ Xong "${pageName}": ${conversations.length} convs`, 1);
    await sleep(500);  // Rate limit giữa các Pages
  }

  // 4. Tổng kết
  console.log('\n═══════════════════════════════════════════════════');
  console.log('  ✅ HOÀN THÀNH');
  console.log(`  Pages đã xử lý : ${pages.length}`);
  console.log(`  Conversations  : ${totalConversations}`);
  console.log(`  Messages       : ${totalMessages}`);
  console.log('═══════════════════════════════════════════════════\n');

  await prisma.$disconnect();
}

main().catch(err => {
  console.error('\n❌ Lỗi:', err.message);
  prisma.$disconnect();
  process.exit(1);
});
