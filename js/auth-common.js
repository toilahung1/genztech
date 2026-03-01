/**
 * GenzTech Auth Common Module v2
 * - Kiểm tra JWT, redirect về login.html nếu chưa đăng nhập
 * - Đồng bộ FB access token từ GT_USER (server) vào tất cả key localStorage
 * - Render user info (avatar + tên + pages) vào sidebar và topbar
 * - Nút đăng xuất: xóa sạch TẤT CẢ key localStorage liên quan
 * - Ẩn nút "Kết Nối" khi đã đăng nhập (token đã có từ server)
 */
(function () {
  'use strict';

  const SERVER_URL = 'https://genztech-production.up.railway.app';

  // ── Tất cả key cần xóa khi đăng xuất ─────────────────────
  const ALL_KEYS = [
    // Auth GenzTech
    'GT_JWT', 'GT_USER',
    // auto-post (gz_*)
    'gz_jwt', 'gz_username', 'gz_connected', 'gz_fb_user',
    'gz_fb_token', 'gz_pages', 'gz_page', 'gz_selected_pages',
    'gz_posts', 'gz_oai_key', 'gz_auto_rules',
    // human-agent (HA_*)
    'HA_FB_TOKEN', 'HA_SERVER_URL', 'HA_VERIFY_TOKEN',
    'HA_OPENAI_KEY', 'HA_PAGE_CONFIGS', 'OPENAI_KEY',
    // legacy keys
    'FB_TOKEN_MANUAL', 'fb_token', 'fbAccessToken', 'fbPages', 'fbToken',
  ];

  // ── Helpers ───────────────────────────────────────────────
  function getJwt() {
    return localStorage.getItem('GT_JWT');
  }

  function getUser() {
    try {
      return JSON.parse(localStorage.getItem('GT_USER') || 'null');
    } catch { return null; }
  }

  function isTokenExpired(token) {
    try {
      const payload = JSON.parse(atob(token.split('.')[1]));
      return payload.exp * 1000 < Date.now();
    } catch { return true; }
  }

  // ── Đồng bộ FB token từ GT_USER vào tất cả key ───────────
  function syncFbToken() {
    const user = getUser();
    if (!user || !user.fb_token) return;
    const token = user.fb_token;
    const pages = user.pages || user.fb_pages || [];

    // Đồng bộ vào tất cả key mà các trang đang dùng
    localStorage.setItem('HA_FB_TOKEN', token);
    localStorage.setItem('FB_TOKEN_MANUAL', token);
    localStorage.setItem('fb_token', token);
    localStorage.setItem('fbAccessToken', token);

    // Đồng bộ cho auto-post (gz_*)
    localStorage.setItem('gz_connected', '1');
    localStorage.setItem('gz_fb_user', JSON.stringify({
      id: user.fb_user_id || '',
      name: user.fb_user_name || '',
      picture: { data: { url: user.fb_avatar || '' } }
    }));
    if (pages.length) {
      localStorage.setItem('gz_pages', JSON.stringify(pages));
      localStorage.setItem('fbPages', JSON.stringify(pages));
    }
  }

  // ── Kiểm tra auth, redirect nếu chưa đăng nhập ───────────
  function requireAuth() {
    const jwt = getJwt();
    if (!jwt || isTokenExpired(jwt)) {
      ALL_KEYS.forEach(function(k) { localStorage.removeItem(k); });
      window.location.href = 'login.html';
      return false;
    }
    syncFbToken();
    return true;
  }

  // ── Đăng xuất: xóa TẤT CẢ key ───────────────────────────
  function handleLogout() {
    if (!confirm('Đăng xuất khỏi GenzTech?')) return;
    ALL_KEYS.forEach(function(k) { localStorage.removeItem(k); });
    window.location.href = 'login.html';
  }

  // ── Ẩn nút kết nối khi đã đăng nhập ─────────────────────
  function hideConnectButtons() {
    const user = getUser();
    if (!user || !user.fb_token) return;

    // Ẩn nút "Kết Nối" / "Kết Nối FB" trong topbar (auto-post)
    var connectBtn = document.getElementById('connectBtn');
    if (connectBtn) connectBtn.style.display = 'none';

    // Ẩn nút kết nối Facebook trong maindashboard
    var fbLoginBtn = document.querySelector('[onclick="handleFBLogin()"]');
    if (fbLoginBtn) fbLoginBtn.style.display = 'none';
  }

  // ── Render user info vào sidebar-footer ───────────────────
  function renderUserSidebar() {
    var container = document.getElementById('gtUserSidebar');
    if (!container) return;
    var user = getUser();
    if (!user) return;
    var name = user.fb_user_name || user.email || '—';
    var email = user.email || '';
    var avatar = user.fb_avatar || '';
    var pages = user.pages || user.fb_pages || [];
    var pagesCount = pages.length || user.pages_count || 0;

    container.style.display = 'flex';
    container.style.flexDirection = 'column';
    container.innerHTML =
      '<div style="display:flex;align-items:center;gap:8px;padding:10px 0;border-bottom:1px solid rgba(255,255,255,.06);margin-bottom:8px">' +
        '<div style="width:32px;height:32px;border-radius:50%;overflow:hidden;flex-shrink:0;background:linear-gradient(135deg,#00d4ff,#6366f1);display:flex;align-items:center;justify-content:center;font-size:12px;font-weight:700;color:#fff">' +
          (avatar
            ? '<img src="' + avatar + '" style="width:100%;height:100%;object-fit:cover" onerror="this.parentElement.innerHTML=\'<i class=\\\'bi bi-person-fill\\\'></i>\'">'
            : '<i class="bi bi-person-fill"></i>') +
        '</div>' +
        '<div style="flex:1;min-width:0">' +
          '<div style="font-size:12px;font-weight:600;color:#fff;white-space:nowrap;overflow:hidden;text-overflow:ellipsis" title="' + name + '">' + name + '</div>' +
          '<div style="font-size:10px;color:rgba(255,255,255,.35);white-space:nowrap;overflow:hidden;text-overflow:ellipsis" title="' + email + '">' + email + '</div>' +
          (pagesCount ? '<div style="font-size:10px;color:#4ade80;margin-top:1px"><i class="bi bi-check-circle-fill" style="font-size:9px"></i> ' + pagesCount + ' Page' + (pagesCount > 1 ? 's' : '') + '</div>' : '') +
        '</div>' +
        '<button onclick="window.GenzAuth.logout()" title="Đăng xuất"' +
          ' style="background:none;border:none;color:rgba(255,255,255,.3);cursor:pointer;padding:4px;font-size:15px;flex-shrink:0;transition:color .2s;border-radius:4px"' +
          ' onmouseover="this.style.color=\'#f87171\';this.style.background=\'rgba(248,113,113,.1)\'"' +
          ' onmouseout="this.style.color=\'rgba(255,255,255,.3)\';this.style.background=\'none\'">' +
          '<i class="bi bi-box-arrow-right"></i>' +
        '</button>' +
      '</div>';
  }

  // ── Render user info vào topbar-right ─────────────────────
  function renderUserTopbar() {
    var badge = document.getElementById('userBadge');
    if (!badge) return;
    var user = getUser();
    if (!user) return;
    var name = user.fb_user_name || user.email || '—';
    var avatar = user.fb_avatar || '';

    badge.style.display = 'flex';
    badge.innerHTML =
      '<div style="width:28px;height:28px;border-radius:50%;overflow:hidden;background:linear-gradient(135deg,#1877f2,#00d4ff);display:flex;align-items:center;justify-content:center;font-weight:700;font-size:11px;color:#fff;flex-shrink:0">' +
        (avatar
          ? '<img src="' + avatar + '" style="width:100%;height:100%;object-fit:cover" onerror="this.parentElement.innerHTML=\'<i class=\\\'bi bi-person-fill\\\'></i>\'">'
          : '<i class="bi bi-person-fill" style="font-size:13px"></i>') +
      '</div>' +
      '<span style="color:rgba(255,255,255,.75);font-size:12.5px;max-width:120px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">' + name + '</span>' +
      '<button onclick="window.GenzAuth.logout()" title="Đăng xuất"' +
        ' style="background:none;border:1px solid rgba(248,113,113,.25);color:#f87171;cursor:pointer;padding:3px 8px;font-size:11px;border-radius:5px;transition:all .2s;white-space:nowrap"' +
        ' onmouseover="this.style.background=\'rgba(248,113,113,.12)\'"' +
        ' onmouseout="this.style.background=\'none\'">' +
        '<i class="bi bi-box-arrow-right"></i> Đăng xuất' +
      '</button>';
  }

  // ── Khởi tạo khi DOM sẵn sàng ────────────────────────────
  function init() {
    if (!requireAuth()) return;
    renderUserSidebar();
    renderUserTopbar();
    hideConnectButtons();
  }

  document.addEventListener('DOMContentLoaded', init);

  // ── Export ra global ──────────────────────────────────────
  window.GenzAuth = {
    logout: handleLogout,
    getUser: getUser,
    getJwt: getJwt,
    requireAuth: requireAuth,
    syncFbToken: syncFbToken,
    SERVER_URL: SERVER_URL,
    // Hàm tiện ích cho các trang dùng
    getFbToken: function () {
      var user = getUser();
      return (user && user.fb_token) || localStorage.getItem('HA_FB_TOKEN') || localStorage.getItem('FB_TOKEN_MANUAL') || '';
    },
    getPages: function () {
      var user = getUser();
      return (user && (user.pages || user.fb_pages)) || JSON.parse(localStorage.getItem('gz_pages') || '[]');
    },
  };
})();
