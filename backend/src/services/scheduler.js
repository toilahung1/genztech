const cron = require('node-cron');
const axios = require('axios');
const { prisma } = require('../middleware/auth');

const FB_GRAPH = 'https://graph.facebook.com/v25.0';

async function processScheduledPosts() {
  try {
    const now = new Date();
    const duePosts = await prisma.post.findMany({
      where: { status: 'pending', scheduledAt: { lte: now } },
      include: { author: { select: { fbToken: true, fbPages: true } } }
    });

    for (const post of duePosts) {
      const token = post.author?.fbToken;
      if (!token) {
        await prisma.post.update({ where: { id: post.id }, data: { status: 'failed', errorMsg: 'Chưa kết nối Facebook' } });
        continue;
      }

      try {
        const pages = Array.isArray(post.author.fbPages) ? post.author.fbPages : [];
        const page = pages.find(p => p.id === post.pageId);
        const pageToken = page?.access_token || token;

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

        // Update post status
        const updateData = { status: 'posted', postFbId: postId, postedAt: new Date() };

        // Handle repeat
        if (post.repeatType === 'daily') {
          const nextTime = new Date(post.scheduledAt);
          nextTime.setDate(nextTime.getDate() + 1);
          // Create next scheduled post
          await prisma.post.create({
            data: {
              content: post.content,
              mediaUrls: post.mediaUrls,
              status: 'pending',
              scheduledAt: nextTime,
              repeatType: 'daily',
              authorId: post.authorId,
              pageId: post.pageId,
              pageName: post.pageName
            }
          });
        } else if (post.repeatType === 'weekly') {
          const nextTime = new Date(post.scheduledAt);
          nextTime.setDate(nextTime.getDate() + 7);
          await prisma.post.create({
            data: {
              content: post.content,
              mediaUrls: post.mediaUrls,
              status: 'pending',
              scheduledAt: nextTime,
              repeatType: 'weekly',
              authorId: post.authorId,
              pageId: post.pageId,
              pageName: post.pageName
            }
          });
        }

        await prisma.post.update({ where: { id: post.id }, data: updateData });
        console.log(`[Scheduler] Posted: ${post.id} → FB:${postId}`);
      } catch (e) {
        const errMsg = e.response?.data?.error?.message || e.message;
        await prisma.post.update({ where: { id: post.id }, data: { status: 'failed', errorMsg: errMsg } });
        console.error(`[Scheduler] Failed post ${post.id}:`, errMsg);
      }
    }
  } catch (e) {
    console.error('[Scheduler] Error:', e.message);
  }
}

function startScheduler() {
  // Run every minute
  cron.schedule('* * * * *', processScheduledPosts);
  console.log('📅 Post scheduler started (runs every minute)');
}

module.exports = { startScheduler, processScheduledPosts };
