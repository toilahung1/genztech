// ------------------------------------------------------
// GENZTECH ADS ASSISTANT — SHARED UTILITIES
// ------------------------------------------------------

const GZ = {
  API: 'https://genztech-production.up.railway.app',

  // -- Auth helpers --
  getToken: () => localStorage.getItem('gz_jwt') || '',
  getUsername: () => localStorage.getItem('gz_username') || '',
  getFbToken: () => localStorage.getItem('gz_fb_token') || localStorage.getItem('fbAccessToken') || '',
  getFbUser: () => JSON.parse(localStorage.getItem('gz_fb_user') || 'null'),
  getFbPages: () => JSON.parse(localStorage.getItem('gz_pages') || localStorage.getItem('fbPages') || '[]'),
  isLoggedIn: () => !!localStorage.getItem('gz_jwt'),
  isFbConnected: () => !!localStorage.getItem('gz_connected'),
  authHeaders: function() {
    const h = { 'Content-Type': 'application/json' };
    const t = this.getToken();
    if (t) h['Authorization'] = 'Bearer ' + t;
    return h;
  },

  // -- Facebook Graph API call --
  fbApi: async function(endpoint, params = {}, method = 'GET') {
    const token = GZ.getFbToken();
    if (!token) throw new Error('Chưa kết nối Facebook. Vui lòng kết nối tại trang Tự Động Đăng Bài.');
    const base = `https://graph.facebook.com/v25.0/${endpoint}`;
    if (method === 'GET') {
      const qs = new URLSearchParams({ ...params, access_token: token }).toString();
      const resp = await fetch(`${base}?${qs}`);
      const data = await resp.json();
      if (data.error) throw new Error(`Facebook API: ${data.error.message} (code ${data.error.code})`);
      return data;
    } else {
      const resp = await fetch(base, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...params, access_token: token })
      });
      const data = await resp.json();
      if (data.error) throw new Error(`Facebook API: ${data.error.message}`);
      return data;
    }
  },

  // -- Backend API call --
  api: async function(path, method = 'GET', body = null) {
    const token = GZ.getToken();
    const opts = {
      method,
      headers: { 'Content-Type': 'application/json', ...(token ? { 'Authorization': `Bearer ${token}` } : {}) }
    };
    if (body) opts.body = JSON.stringify(body);
    const resp = await fetch(`${GZ.API}${path}`, opts);
    const data = await resp.json();
    if (!resp.ok) throw new Error(data.error || data.message || `Lỗi server (${resp.status})`);
    return data;
  },

  // -- Get Ad Accounts --
  getAdAccounts: async function() {
    return GZ.fbApi('me/adaccounts', {
      fields: 'id,name,account_status,balance,amount_spent,currency,spend_cap,daily_spend_limit,funding_source_details,disable_reason'
    });
  },

  // -- Get Account Insights --
  getAccountInsights: async function(accountId, datePreset = 'last_30d') {
    return GZ.fbApi(`${accountId}/insights`, {
      fields: 'impressions,clicks,spend,cpm,cpc,ctr,reach,frequency,actions',
      date_preset: datePreset
    });
  },

  // -- Format helpers --
  vnd: function(n) {
    if (n >= 1000000000) return (n / 1000000000).toFixed(1) + ' tỷ';
    if (n >= 1000000) return (n / 1000000).toFixed(1) + ' triệu';
    return new Intl.NumberFormat('vi-VN').format(Math.round(n)) + 'đ';
  },
  num: function(n) {
    if (n >= 1000000) return (n / 1000000).toFixed(1) + 'M';
    if (n >= 1000) return (n / 1000).toFixed(1) + 'K';
    return new Intl.NumberFormat('vi-VN').format(Math.round(n));
  },
  timeAgo: function(ts) {
    const diff = Date.now() - ts;
    if (diff < 60000) return 'Vừa xong';
    if (diff < 3600000) return Math.floor(diff / 60000) + ' phút trước';
    if (diff < 86400000) return Math.floor(diff / 3600000) + ' giờ trước';
    return Math.floor(diff / 86400000) + ' ngày trước';
  },

  // -- Toast --
  toast: function(msg, type = 'info', duration = 3500) {
    const c = document.getElementById('toastContainer');
    if (!c) return;
    const t = document.createElement('div');
    t.className = `toast ${type}`;
    const icons = { success: 'check-circle-fill', error: 'x-circle-fill', info: 'info-circle-fill', warn: 'exclamation-triangle-fill' };
    t.innerHTML = `<i class="bi bi-${icons[type] || 'info-circle-fill'}" style="font-size:16px;flex-shrink:0"></i><span>${msg}</span>`;
    c.appendChild(t);
    setTimeout(() => { t.style.opacity = '0'; }, duration);
    setTimeout(() => t.remove(), duration + 400);
  },

  // -- Copy --
  copy: function(text, msg = 'Đã copy!') {
    navigator.clipboard.writeText(text).then(() => GZ.toast(msg, 'success'));
  }
};

// -- Sidebar active state --
document.addEventListener('DOMContentLoaded', () => {
  const path = window.location.pathname.split('/').pop() || 'index.html';
  document.querySelectorAll('.nav-item').forEach(a => {
    if (a.getAttribute('href') === path) a.classList.add('active');
  });

  // Show login warning if not logged in
  if (!GZ.isLoggedIn()) {
    const subtitle = document.querySelector('.page-subtitle');
    if (subtitle) {
      const notice = document.createElement('div');
      notice.style.cssText = 'background:rgba(251,191,36,.06);border:1px solid rgba(251,191,36,.15);border-radius:10px;padding:10px 14px;font-size:12.5px;color:rgba(255,255,255,.5);margin-bottom:16px;display:flex;align-items:center;gap:8px';
      notice.innerHTML = '⚠️ Chưa đăng nhập — <a href="auto-post.html" style="color:#fbbf24;text-decoration:none;font-weight:600">Đăng nhập ngay →</a>';
      subtitle.insertAdjacentElement('afterend', notice);
    }
  }

  // Show FB warning only on pages that require FB (data-require-fb attribute on body)
  const requireFb = document.body && document.body.dataset.requireFb;
  if (requireFb && !GZ.isFbConnected()) {
    const subtitle = document.querySelector('.page-subtitle');
    if (subtitle) {
      const notice = document.createElement('div');
      notice.id = 'fbWarningBanner';
      notice.style.cssText = 'background:rgba(24,119,242,.06);border:1px solid rgba(24,119,242,.2);border-radius:10px;padding:10px 14px;font-size:12.5px;color:rgba(255,255,255,.6);margin-bottom:16px;display:flex;align-items:center;gap:8px';
      notice.innerHTML = '<i class="bi bi-facebook" style="color:#1877f2"></i> Chưa kết nối Facebook — tính năng này cần Facebook. <a href="auto-post.html" style="color:#1877f2;text-decoration:none;font-weight:600">Kết nối ngay →</a>';
      subtitle.insertAdjacentElement('afterend', notice);
    }
  }
});
