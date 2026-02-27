const cron = require('node-cron');
const axios = require('axios');

const FB_GRAPH = 'https://graph.facebook.com/v25.0';

async function processScheduledPosts() {
  try {
    // Lazy-load to avoid circular dependency
    const { postsStore } = require('../api/posts');
    const { users } = require('../api/auth');
    const now = new Date();

    for (const [userId, posts] of postsStore.entries()) {
      const duePosts = posts.filter(p => p.status === 'pending' && new Date(p.scheduledAt) <= now);

      // Find user's FB token
      let fbToken = null;
      let fbPages = [];
      for (const u of users.values()) {
        if (u.id === userId) { fbToken = u.fbToken; fbPages = u.fbPages || []; break; }
      }

      for (const post of duePosts) {
        if (!fbToken) {
          post.status = 'failed';
          post.errorMsg = 'Chưa kết nối Facebook';
          continue;
        }

        try {
          const page = fbPages.find(p => p.id === post.pageId);
          const pageToken = page?.access_token || fbToken;

          let postId;
          if (post.mediaUrls && post.mediaUrls.length > 0) {
            const r = await axios.post(`${FB_GRAPH}/${post.pageId}/photos`, null, {
              params: { url: post.mediaUrls[0], caption: post.content, access_token: pageToken }
            });
            postId = r.data.id;
          } else {
            const r = await axios.post(`${FB_GRAPH}/${post.pageId}/feed`, null, {
              params: { message: post.content, access_token: pageToken }
            });
            postId = r.data.id;
          }

          post.status = 'posted';
          post.postFbId = postId;
          post.postedAt = new Date().toISOString();

          // Handle repeat
          if (post.repeatType === 'daily' || post.repeatType === 'weekly') {
            const { postsStore: ps } = require('../api/posts');
            const nextTime = new Date(post.scheduledAt);
            if (post.repeatType === 'daily') nextTime.setDate(nextTime.getDate() + 1);
            else nextTime.setDate(nextTime.getDate() + 7);

            const { default: postIdCounter } = require('../api/posts');
            const userPosts = ps.get(userId) || [];
            userPosts.push({
              id: String(Date.now()),
              content: post.content,
              mediaUrls: post.mediaUrls,
              status: 'pending',
              scheduledAt: nextTime.toISOString(),
              repeatType: post.repeatType,
              authorId: userId,
              pageId: post.pageId,
              pageName: post.pageName,
              createdAt: new Date().toISOString()
            });
          }

          console.log(`[Scheduler] Posted: ${post.id} → FB:${postId}`);
        } catch (e) {
          const errMsg = e.response?.data?.error?.message || e.message;
          post.status = 'failed';
          post.errorMsg = errMsg;
          console.error(`[Scheduler] Failed post ${post.id}:`, errMsg);
        }
      }
    }
  } catch (e) {
    console.error('[Scheduler] Error:', e.message);
  }
}

function startScheduler() {
  cron.schedule('* * * * *', processScheduledPosts);
  console.log('📅 Post scheduler started (runs every minute)');
}

module.exports = { startScheduler, processScheduledPosts };
