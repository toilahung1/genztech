const express = require('express');
const axios   = require('axios');
const auth    = require('../middleware/auth');

const router = express.Router();
router.use(auth);

// Dùng proxy endpoint tương thích OpenAI (pre-configured trong môi trường)
// Nếu có OPENAI_BASE_URL thì dùng, không thì dùng OpenAI gốc
const OPENAI_BASE = process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1';
const OPENAI_URL  = `${OPENAI_BASE}/chat/completions`;
const AI_MODEL    = process.env.AI_MODEL || 'gpt-4.1-mini';

// ============================================================
//  POST /api/ai/generate
//  Tạo nội dung bài viết bằng AI (OpenAI key ở backend, bảo mật)
// ============================================================
router.post('/generate', async (req, res) => {
  const { topic, tone = 'friendly', industry = 'general', length = 'medium' } = req.body;
  if (!topic) return res.status(400).json({ error: 'topic là bắt buộc' });

  const toneMap = {
    professional: 'chuyên nghiệp, lịch sự',
    friendly:     'thân thiện, gần gũi',
    excited:      'hào hứng, năng động',
    informative:  'thông tin, giáo dục',
    humorous:     'hài hước, vui vẻ',
  };
  const industryMap = {
    general:    'tổng quát',
    ecommerce:  'thương mại điện tử',
    food:       'ẩm thực & nhà hàng',
    fashion:    'thời trang',
    tech:       'công nghệ',
    beauty:     'làm đẹp & spa',
    education:  'giáo dục',
    realestate: 'bất động sản',
    fitness:    'thể thao & sức khỏe',
    travel:     'du lịch',
  };
  const lengthMap = {
    short:  'ngắn gọn khoảng 80-120 từ',
    medium: 'vừa phải khoảng 180-220 từ',
    long:   'chi tiết khoảng 350-420 từ',
  };

  const prompt = `Bạn là chuyên gia marketing Facebook người Việt Nam.
Tạo 3 phiên bản bài đăng Facebook KHÁC NHAU cho chủ đề: "${topic}"
- Ngành: ${industryMap[industry] || 'tổng quát'}
- Giọng văn: ${toneMap[tone] || 'thân thiện'}
- Độ dài: ${lengthMap[length] || 'vừa phải'}
- Ngôn ngữ: Tiếng Việt tự nhiên
- Mỗi bài phải có: emoji phù hợp, nội dung hấp dẫn, call-to-action rõ ràng, 3-5 hashtag cuối bài
- 3 phiên bản phải khác nhau về cách tiếp cận (ví dụ: storytelling, list, câu hỏi...)

Trả về JSON hợp lệ: {"posts":["bài 1 đầy đủ","bài 2 đầy đủ","bài 3 đầy đủ"]}`;

  try {
    const response = await axios.post(OPENAI_URL, {
      model:       AI_MODEL,
      messages:    [{ role: 'user', content: prompt }],
      temperature: 0.8,
      max_tokens:  1800,
    }, {
      headers: {
        'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
        'Content-Type':  'application/json',
      },
      timeout: 45000,
    });

    const raw = response.data.choices[0].message.content;
    let posts;
    try {
      posts = JSON.parse(raw.match(/\{[\s\S]*\}/)[0]).posts;
    } catch {
      posts = [raw];
    }

    res.json({ success: true, posts });
  } catch (err) {
    const msg = err.response?.data?.error?.message || err.message;
    console.error('[AI Generate Error]', msg);
    // Fallback: trả về 3 bài mẫu nếu AI lỗi
    const fallbackPosts = [
      `🌟 ${topic}\n\nChúng tôi tự hào mang đến cho bạn những trải nghiệm tốt nhất!\n\n✅ Chất lượng hàng đầu\n✅ Giá cả hợp lý\n✅ Dịch vụ tận tâm\n\nLiên hệ ngay để được tư vấn miễn phí! 📞\n\n#${topic.replace(/\s+/g,'').toLowerCase()} #genztech #vietnam`,
      `💡 Bạn đang tìm kiếm ${topic}?\n\nĐừng bỏ lỡ cơ hội tuyệt vời này! Chúng tôi cam kết:\n→ Sản phẩm/dịch vụ chất lượng cao\n→ Hỗ trợ 24/7\n→ Bảo hành uy tín\n\nNhắn tin ngay để nhận ưu đãi đặc biệt! 🎁\n\n#${topic.replace(/\s+/g,'').toLowerCase()} #ưuđãi #chấtlượng`,
      `❓ Bạn có biết về ${topic} chưa?\n\nHàng ngàn khách hàng đã tin tưởng và hài lòng với chúng tôi. Hôm nay là lúc bạn trải nghiệm sự khác biệt!\n\n🔥 Ưu đãi có hạn — Đặt ngay hôm nay!\n\n#${topic.replace(/\s+/g,'').toLowerCase()} #trending #hot`,
    ];
    res.json({ success: true, posts: fallbackPosts, fallback: true });
  }
});

// ============================================================
//  POST /api/ai/hashtags
//  Gợi ý hashtag cho chủ đề
// ============================================================
router.post('/hashtags', async (req, res) => {
  const { topic, industry = 'general' } = req.body;
  if (!topic) return res.status(400).json({ error: 'topic là bắt buộc' });

  const prompt = `Gợi ý 15 hashtag tiếng Việt phổ biến và hiệu quả cho bài đăng Facebook về chủ đề: "${topic}" trong ngành ${industry}.
Trả về JSON: {"hashtags":["#tag1","#tag2",...]}
Hashtag phải: không dấu, không khoảng trắng, phù hợp thị trường Việt Nam.`;

  try {
    const response = await axios.post(OPENAI_URL, {
      model:       AI_MODEL,
      messages:    [{ role: 'user', content: prompt }],
      temperature: 0.5,
      max_tokens:  300,
    }, {
      headers: {
        'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
        'Content-Type':  'application/json',
      },
      timeout: 15000,
    });

    const raw = response.data.choices[0].message.content;
    let hashtags;
    try {
      hashtags = JSON.parse(raw.match(/\{[\s\S]*\}/)[0]).hashtags;
    } catch {
      hashtags = raw.match(/#\w+/g) || [];
    }

    res.json({ success: true, hashtags });
  } catch (err) {
    console.error('[AI Hashtags Error]', err.message);
    // Fallback hashtags
    const fallback = [`#${topic.replace(/\s+/g,'').toLowerCase()}`, '#genztech', '#vietnam', '#marketing', '#facebook', '#quangcao', '#kinhdoanh', '#online', '#trending', '#hot'];
    res.json({ success: true, hashtags: fallback, fallback: true });
  }
});

module.exports = router;
