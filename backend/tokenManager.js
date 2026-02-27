/**
 * GenZTech — Facebook Token Manager
 * Xử lý: exchange short→long token, lấy page tokens, auto-refresh, kiểm tra hết hạn
 * PostgreSQL async version
 */

const axios = require('axios');
const { tokenStmt, pageStmt, logStmt } = require('./database');

const FB_GRAPH = 'https://graph.facebook.com/v19.0';
const APP_ID     = process.env.FB_APP_ID;
const APP_SECRET = process.env.FB_APP_SECRET;

// ============================================================
//  1. Đổi Short-lived → Long-lived User Token (60 ngày)
// ============================================================
async function exchangeToLongLived(shortToken) {
  const res = await axios.get(`${FB_GRAPH}/oauth/access_token`, {
    params: {
      grant_type:        'fb_exchange_token',
      client_id:         APP_ID,
      client_secret:     APP_SECRET,
      fb_exchange_token: shortToken,
    },
  });
  const { access_token, expires_in } = res.data;
  const expiresAt = new Date(Date.now() + (expires_in || 5184000) * 1000).toISOString();
  return { longToken: access_token, expiresAt };
}

// ============================================================
//  2. Lấy thông tin User từ token
// ============================================================
async function getUserInfo(token) {
  const res = await axios.get(`${FB_GRAPH}/me`, {
    params: { access_token: token, fields: 'id,name,picture.type(large)' },
  });
  return res.data;
}

// ============================================================
//  3. Lấy danh sách Pages + Page Access Token (không hết hạn)
// ============================================================
async function getPages(longToken) {
  const res = await axios.get(`${FB_GRAPH}/me/accounts`, {
    params: {
      access_token: longToken,
      fields: 'id,name,access_token,picture,category',
    },
  });
  return res.data.data || [];
}

// ============================================================
//  4. Kiểm tra token còn hạn không
// ============================================================
async function inspectToken(token) {
  const res = await axios.get(`${FB_GRAPH}/debug_token`, {
    params: {
      input_token:  token,
      access_token: `${APP_ID}|${APP_SECRET}`,
    },
  });
  return res.data.data;
}

// ============================================================
//  5. Refresh Long-lived Token
// ============================================================
async function refreshLongToken(currentLongToken) {
  try {
    const { longToken, expiresAt } = await exchangeToLongLived(currentLongToken);
    return { longToken, expiresAt, success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

// ============================================================
//  6. Full connect flow: nhận short token → lưu tất cả vào DB
// ============================================================
async function fullConnect(userId, shortToken) {
  // Bước 1: Đổi sang Long-lived token
  const { longToken, expiresAt } = await exchangeToLongLived(shortToken);

  // Bước 2: Lấy thông tin user
  const userInfo = await getUserInfo(longToken);

  // Bước 3: Lưu token vào DB (async)
  const fbTokenRow = await tokenStmt.upsert({
    user_id:            userId,
    fb_user_id:         userInfo.id,
    fb_user_name:       userInfo.name,
    fb_user_picture:    userInfo.picture?.data?.url || null,
    short_token:        shortToken,
    long_token:         longToken,
    long_token_expires: expiresAt,
  });

  // Bước 4: Lấy danh sách Pages
  const pages = await getPages(longToken);

  // Bước 5: Lưu Page tokens (page token không hết hạn)
  for (const page of pages) {
    await pageStmt.upsert({
      user_id:      userId,
      fb_token_id:  fbTokenRow.id,
      page_id:      page.id,
      page_name:    page.name,
      page_token:   page.access_token,
      page_picture: page.picture?.data?.url || null,
      category:     page.category || null,
    });
  }

  await logStmt.create(userId, userInfo.id, 'exchange', true, `Exchanged to long-lived, expires: ${expiresAt}`);

  return {
    fbUser:   userInfo,
    longToken,
    expiresAt,
    pages:    pages.map(p => ({ id: p.id, name: p.name, picture: p.picture?.data?.url })),
  };
}

// ============================================================
//  7. Auto-refresh tất cả token sắp hết hạn (chạy bởi cron)
//     Refresh token còn <= 30 ngày
// ============================================================
async function autoRefreshExpiring() {
  const expiring = await tokenStmt.findAllExpiring(30);
  const results = [];

  for (const row of expiring) {
    try {
      const { longToken, expiresAt, success } = await refreshLongToken(row.long_token);
      if (success) {
        await tokenStmt.updateLong(longToken, expiresAt, row.user_id, row.fb_user_id);

        const pages = await getPages(longToken);
        for (const page of pages) {
          await pageStmt.upsert({
            user_id:      row.user_id,
            fb_token_id:  row.id,
            page_id:      page.id,
            page_name:    page.name,
            page_token:   page.access_token,
            page_picture: page.picture?.data?.url || null,
            category:     page.category || null,
          });
        }

        await logStmt.create(row.user_id, row.fb_user_id, 'refresh', true, `Refreshed, new expiry: ${expiresAt}`);
        results.push({ fb_user_id: row.fb_user_id, success: true, expiresAt });
      }
    } catch (err) {
      await logStmt.create(row.user_id, row.fb_user_id, 'refresh', false, err.message).catch(() => {});
      results.push({ fb_user_id: row.fb_user_id, success: false, error: err.message });
    }
  }

  return results;
}

// ============================================================
//  8. Đăng bài lên Facebook Page
// ============================================================
async function postToPage(pageId, pageToken, content, linkUrl = null, photoIds = null, videoId = null) {
  const endpoint = `${FB_GRAPH}/${pageId}/feed`;

  // Video: publish video đã upload trước
  if (videoId) {
    const body = {
      message:        content,
      attached_media: [{ media_fbid: videoId }],
      access_token:   pageToken,
    };
    const res = await axios.post(endpoint, body);
    return res.data;
  }

  // Ảnh: gửi dạng body POST với attached_media array
  if (photoIds && photoIds.length > 0) {
    const body = {
      message:        content,
      attached_media: photoIds.map(id => ({ media_fbid: id })),
      access_token:   pageToken,
    };
    const res = await axios.post(endpoint, body);
    return res.data;
  }

  // Text + link
  const body = { message: content, access_token: pageToken };
  if (linkUrl) body.link = linkUrl;
  const res = await axios.post(endpoint, body);
  return res.data;
}

module.exports = {
  exchangeToLongLived,
  getUserInfo,
  getPages,
  inspectToken,
  refreshLongToken,
  fullConnect,
  autoRefreshExpiring,
  postToPage,
};
