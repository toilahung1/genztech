/**
 * GenZTech — Scheduler (node-cron)
 * PostgreSQL async version
 * - Mỗi phút: kiểm tra bài viết đến giờ đăng
 * - Mỗi ngày 3h sáng: auto-refresh token sắp hết hạn
 * - Mỗi ngày 6h sáng: dọn dẹp log cũ
 */
const cron = require('node-cron');
const { schedStmt, histStmt, pageStmt, pool } = require('./database');
const { postToPage, autoRefreshExpiring } = require('./tokenManager');

let isRunning = false;

// ============================================================
//  JOB 1: Kiểm tra và đăng bài theo lịch (mỗi phút)
// ============================================================
async function checkAndPost() {
  if (isRunning) return;
  isRunning = true;
  try {
    const duePosts = await schedStmt.findPending();
    if (duePosts.length === 0) { isRunning = false; return; }
    console.log(`[Scheduler] Found ${duePosts.length} post(s) due`);

    for (const post of duePosts) {
      try {
        const pageRow = await pageStmt.findByPageId(post.user_id, post.page_id);
        if (!pageRow) {
          await schedStmt.updateStatus('failed', null, 'Page token not found in database', post.id);
          continue;
        }

        const result = await postToPage(
          post.page_id,
          pageRow.page_token,
          post.content,
          post.link_url,
          post.image_url
        );

        await schedStmt.updateStatus('posted', result.id || null, null, post.id);
        await histStmt.create({
          user_id:    post.user_id,
          page_id:    post.page_id,
          page_name:  post.page_name,
          content:    post.content,
          fb_post_id: result.id || null,
          status:     'posted',
          error_msg:  null,
        });

        // Xử lý lặp lại (repeat)
        if (post.repeat_type && post.repeat_type !== 'none') {
          const nextAt = calcNextRepeat(post.scheduled_at, post.repeat_type);
          if (nextAt) {
            await schedStmt.create({
              user_id:      post.user_id,
              page_id:      post.page_id,
              page_name:    post.page_name,
              content:      post.content,
              image_url:    post.image_url,
              link_url:     post.link_url,
              post_type:    post.post_type,
              scheduled_at: nextAt,
              repeat_type:  post.repeat_type,
            });
          }
        }

        console.log(`[Scheduler] ✓ Posted: "${post.content.slice(0, 40)}..." → ${result.id}`);
      } catch (err) {
        const msg = err.response?.data?.error?.message || err.message;
        const retries = (post.retry_count || 0) + 1;
        if (retries >= 3) {
          await schedStmt.updateStatus('failed', null, msg, post.id);
          await histStmt.create({
            user_id:    post.user_id,
            page_id:    post.page_id,
            page_name:  post.page_name,
            content:    post.content,
            fb_post_id: null,
            status:     'failed',
            error_msg:  msg,
          });
          console.error(`[Scheduler] ✗ Failed (max retries): ${msg}`);
        } else {
          const retryAt = new Date(Date.now() + 5 * 60 * 1000).toISOString();
          await schedStmt.updateStatus('pending', null, `Retry ${retries}: ${msg}`, post.id);
          await pool.query('UPDATE scheduled_posts SET scheduled_at = $1 WHERE id = $2', [retryAt, post.id]);
          console.warn(`[Scheduler] ↺ Retry ${retries}/3 in 5min: ${msg}`);
        }
      }
    }
  } finally {
    isRunning = false;
  }
}

// ============================================================
//  JOB 2: Auto-refresh token sắp hết hạn (3h sáng mỗi ngày)
// ============================================================
async function runTokenRefresh() {
  console.log('[TokenRefresh] Checking for expiring tokens...');
  try {
    const results = await autoRefreshExpiring();
    if (results.length > 0) {
      console.log(`[TokenRefresh] Refreshed ${results.length} token(s):`, results);
    } else {
      console.log('[TokenRefresh] No tokens need refresh');
    }
  } catch (err) {
    console.error('[TokenRefresh] Error:', err.message);
  }
}

// ============================================================
//  JOB 3: Dọn dẹp log cũ hơn 30 ngày (6h sáng mỗi ngày)
// ============================================================
async function cleanupOldLogs() {
  try {
    const r1 = await pool.query(`DELETE FROM token_refresh_log WHERE created_at < NOW() - INTERVAL '30 days'`);
    const r2 = await pool.query(`DELETE FROM post_history WHERE posted_at < NOW() - INTERVAL '90 days'`);
    console.log(`[Cleanup] Removed ${r1.rowCount} log entries, ${r2.rowCount} old history entries`);
  } catch (err) {
    console.error('[Cleanup] Error:', err.message);
  }
}

// ============================================================
//  Tính thời điểm lặp lại tiếp theo
// ============================================================
function calcNextRepeat(scheduledAt, repeatType) {
  const d = new Date(scheduledAt);
  switch (repeatType) {
    case 'daily':   d.setDate(d.getDate() + 1); break;
    case 'weekly':  d.setDate(d.getDate() + 7); break;
    case 'monthly': d.setMonth(d.getMonth() + 1); break;
    default: return null;
  }
  return d.toISOString();
}

// ============================================================
//  Khởi động tất cả cron jobs
// ============================================================
function startScheduler() {
  cron.schedule('* * * * *', checkAndPost);
  cron.schedule('0 3 * * *', runTokenRefresh);
  cron.schedule('0 6 * * *', cleanupOldLogs);
  console.log('[Scheduler] ✓ All cron jobs started');
  console.log('  → Post checker:    every minute');
  console.log('  → Token refresh:   daily at 03:00');
  console.log('  → Log cleanup:     daily at 06:00');
}

module.exports = { startScheduler, checkAndPost, runTokenRefresh };
