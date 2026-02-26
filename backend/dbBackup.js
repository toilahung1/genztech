/**
 * dbBackup.js - Tự động backup/restore SQLite database lên GitHub
 * Giải quyết vấn đề mất data khi Railway redeploy
 */

const fs = require('fs');
const path = require('path');
const https = require('https');

const GITHUB_TOKEN = process.env.GITHUB_TOKEN || process.env.BACKUP_GITHUB_TOKEN;
const GITHUB_REPO = process.env.GITHUB_REPO || 'toilahung1/genztech';
const GITHUB_BRANCH = 'db-backup';
const GITHUB_FILE_PATH = 'data/genztech.db.b64';
const DB_PATH = process.env.DB_PATH || path.join(__dirname, 'data', 'genztech.db');

// Đảm bảo thư mục data tồn tại
const dataDir = path.dirname(DB_PATH);
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

/**
 * Gọi GitHub API
 */
function githubAPI(method, endpoint, body = null) {
  return new Promise((resolve, reject) => {
    if (!GITHUB_TOKEN) {
      return reject(new Error('GITHUB_TOKEN không được cấu hình'));
    }

    const options = {
      hostname: 'api.github.com',
      path: `/repos/${GITHUB_REPO}/${endpoint}`,
      method: method,
      headers: {
        'Authorization': `token ${GITHUB_TOKEN}`,
        'User-Agent': 'GenZTech-Backend',
        'Content-Type': 'application/json',
        'Accept': 'application/vnd.github.v3+json'
      }
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, data: JSON.parse(data) });
        } catch {
          resolve({ status: res.statusCode, data });
        }
      });
    });

    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

/**
 * Restore DB từ GitHub khi khởi động
 */
async function restoreFromGitHub() {
  if (!GITHUB_TOKEN) {
    console.log('[DB Backup] Không có GITHUB_TOKEN — bỏ qua restore');
    return false;
  }

  try {
    console.log('[DB Backup] Đang kiểm tra backup trên GitHub...');
    const res = await githubAPI('GET', `contents/${GITHUB_FILE_PATH}?ref=${GITHUB_BRANCH}`);

    if (res.status === 200 && res.data.content) {
      // Decode base64 content (GitHub trả về base64 của base64)
      const b64Content = res.data.content.replace(/\n/g, '');
      const dbBuffer = Buffer.from(b64Content, 'base64');

      // Kiểm tra xem đây có phải file b64 không (nếu đúng thì decode thêm 1 lần)
      const dbContent = dbBuffer.toString('utf8').trim();
      let finalBuffer;
      if (dbContent.match(/^[A-Za-z0-9+/=\n]+$/) && dbContent.length > 100) {
        // Đây là base64 của DB
        finalBuffer = Buffer.from(dbContent, 'base64');
      } else {
        finalBuffer = dbBuffer;
      }

      fs.writeFileSync(DB_PATH, finalBuffer);
      console.log(`[DB Backup] ✅ Đã restore DB từ GitHub (${finalBuffer.length} bytes)`);
      return true;
    } else {
      console.log('[DB Backup] Chưa có backup trên GitHub — bắt đầu với DB mới');
      return false;
    }
  } catch (err) {
    console.log('[DB Backup] Lỗi khi restore:', err.message);
    return false;
  }
}

/**
 * Backup DB lên GitHub
 */
async function backupToGitHub() {
  if (!GITHUB_TOKEN) return;
  if (!fs.existsSync(DB_PATH)) return;

  try {
    const dbBuffer = fs.readFileSync(DB_PATH);
    const b64Content = dbBuffer.toString('base64');

    // Lấy SHA của file hiện tại (nếu có) để update
    let sha = null;
    try {
      const existing = await githubAPI('GET', `contents/${GITHUB_FILE_PATH}?ref=${GITHUB_BRANCH}`);
      if (existing.status === 200) {
        sha = existing.data.sha;
      }
    } catch {}

    const body = {
      message: `[Auto Backup] DB snapshot ${new Date().toISOString()}`,
      content: Buffer.from(b64Content).toString('base64'),
      branch: GITHUB_BRANCH
    };
    if (sha) body.sha = sha;

    const res = await githubAPI('PUT', `contents/${GITHUB_FILE_PATH}`, body);

    if (res.status === 200 || res.status === 201) {
      console.log(`[DB Backup] ✅ Đã backup DB lên GitHub (${dbBuffer.length} bytes)`);
    } else {
      console.log('[DB Backup] Lỗi backup:', res.status, JSON.stringify(res.data).substring(0, 100));
    }
  } catch (err) {
    console.log('[DB Backup] Lỗi khi backup:', err.message);
  }
}

/**
 * Đảm bảo branch db-backup tồn tại
 */
async function ensureBackupBranch() {
  if (!GITHUB_TOKEN) return;

  try {
    // Kiểm tra branch đã tồn tại chưa
    const res = await githubAPI('GET', `git/ref/heads/${GITHUB_BRANCH}`);
    if (res.status === 200) return; // Branch đã tồn tại

    // Lấy SHA của main branch để tạo branch mới
    const mainRef = await githubAPI('GET', 'git/ref/heads/main');
    if (mainRef.status !== 200) return;

    const sha = mainRef.data.object.sha;
    await githubAPI('POST', 'git/refs', {
      ref: `refs/heads/${GITHUB_BRANCH}`,
      sha: sha
    });
    console.log(`[DB Backup] ✅ Đã tạo branch ${GITHUB_BRANCH}`);
  } catch (err) {
    console.log('[DB Backup] Lỗi tạo branch:', err.message);
  }
}

// Backup tự động mỗi 5 phút nếu DB có thay đổi
let lastBackupSize = 0;
let backupTimer = null;

function startAutoBackup(intervalMs = 5 * 60 * 1000) {
  if (backupTimer) clearInterval(backupTimer);
  backupTimer = setInterval(async () => {
    if (!fs.existsSync(DB_PATH)) return;
    const currentSize = fs.statSync(DB_PATH).size;
    if (currentSize !== lastBackupSize) {
      lastBackupSize = currentSize;
      await backupToGitHub();
    }
  }, intervalMs);
  console.log(`[DB Backup] Auto-backup mỗi ${intervalMs / 60000} phút`);
}

module.exports = {
  restoreFromGitHub,
  backupToGitHub,
  ensureBackupBranch,
  startAutoBackup
};
