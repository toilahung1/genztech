/**
 * GenzTech — Auth Common Module
 * Dùng chung cho tất cả các trang: kiểm tra JWT, hiển thị user info, đăng xuất
 */

(function () {
  'use strict';

  const SERVER_URL = localStorage.getItem('HA_SERVER_URL') || 'https://genztech-production.up.railway.app';

  // ── Kiểm tra JWT ──────────────────────────────────────────
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

  function requireAuth() {
    const jwt = getJwt();
    if (!jwt || isTokenExpired(jwt)) {
      localStorage.removeItem('GT_JWT');
      localStorage.removeItem('GT_USER');
      window.location.href = 'login.html';
      return false;
    }
    // Tự động load FB token từ tài khoản vào localStorage
    const user = getUser();
    if (user && user.fb_token) {
      localStorage.setItem('HA_FB_TOKEN', user.fb_token);
      localStorage.setItem('FB_TOKEN_MANUAL', user.fb_token);
      localStorage.setItem('fb_token', user.fb_token);
    }
    return true;
  }

  function handleLogout() {
    if (!confirm('Đăng xuất khỏi GenzTech?')) return;
    localStorage.removeItem('GT_JWT');
    localStorage.removeItem('GT_USER');
    window.location.href = 'login.html';
  }

  // ── Render user info vào sidebar-footer ───────────────────
  function renderUserSidebar() {
    const container = document.getElementById('gtUserSidebar');
    if (!container) return;
    const user = getUser();
    if (!user) return;

    const name = user.fb_user_name || user.email || '—';
    const email = user.email || '';
    const avatar = user.fb_avatar || '';

    container.style.display = 'flex';
    container.innerHTML = `
      <div style="display:flex;align-items:center;gap:8px;padding:10px 0 10px;border-bottom:1px solid rgba(255,255,255,.06);margin-bottom:8px">
        <div style="width:32px;height:32px;border-radius:50%;overflow:hidden;flex-shrink:0;background:linear-gradient(135deg,#00d4ff,#6366f1);display:flex;align-items:center;justify-content:center;font-size:12px;font-weight:700;color:#fff">
          ${avatar
            ? `<img src="${avatar}" style="width:100%;height:100%;object-fit:cover" onerror="this.parentElement.innerHTML='<i class=\\'bi bi-person-fill\\'></i>'">`
            : '<i class="bi bi-person-fill"></i>'}
        </div>
        <div style="flex:1;min-width:0">
          <div style="font-size:12px;font-weight:600;color:#fff;white-space:nowrap;overflow:hidden;text-overflow:ellipsis" title="${name}">${name}</div>
          <div style="font-size:10px;color:rgba(255,255,255,.35);white-space:nowrap;overflow:hidden;text-overflow:ellipsis" title="${email}">${email}</div>
        </div>
        <button onclick="window.GenzAuth.logout()" title="Đăng xuất"
          style="background:none;border:none;color:rgba(255,255,255,.3);cursor:pointer;padding:4px;font-size:15px;flex-shrink:0;transition:color .2s;border-radius:4px"
          onmouseover="this.style.color='#f87171';this.style.background='rgba(248,113,113,.1)'"
          onmouseout="this.style.color='rgba(255,255,255,.3)';this.style.background='none'">
          <i class="bi bi-box-arrow-right"></i>
        </button>
      </div>
    `;
  }

  // ── Render user info vào topbar-right ─────────────────────
  function renderUserTopbar() {
    const badge = document.getElementById('userBadge');
    if (!badge) return;
    const user = getUser();
    if (!user) return;

    const name = user.fb_user_name || user.email || '—';
    const avatar = user.fb_avatar || '';

    badge.style.display = 'flex';
    badge.innerHTML = `
      <div style="width:28px;height:28px;border-radius:50%;overflow:hidden;background:linear-gradient(135deg,#1877f2,#00d4ff);display:flex;align-items:center;justify-content:center;font-weight:700;font-size:11px;color:#fff;flex-shrink:0">
        ${avatar
          ? `<img src="${avatar}" style="width:100%;height:100%;object-fit:cover" onerror="this.parentElement.innerHTML='<i class=\\'bi bi-person-fill\\'></i>'">`
          : '<i class="bi bi-person-fill" style="font-size:13px"></i>'}
      </div>
      <span style="color:rgba(255,255,255,.75);font-size:12.5px;max-width:120px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${name}</span>
      <button onclick="window.GenzAuth.logout()" title="Đăng xuất"
        style="background:none;border:1px solid rgba(248,113,113,.25);color:#f87171;cursor:pointer;padding:3px 8px;font-size:11px;border-radius:5px;transition:all .2s;white-space:nowrap"
        onmouseover="this.style.background='rgba(248,113,113,.12)'"
        onmouseout="this.style.background='none'">
        <i class="bi bi-box-arrow-right"></i> Đăng xuất
      </button>
    `;
  }

  // ── Khởi tạo khi DOM sẵn sàng ────────────────────────────
  function init() {
    if (!requireAuth()) return;
    renderUserSidebar();
    renderUserTopbar();
  }

  document.addEventListener('DOMContentLoaded', init);

  // Export ra global
  window.GenzAuth = {
    logout: handleLogout,
    getUser,
    getJwt,
    requireAuth,
    SERVER_URL,
  };
})();
