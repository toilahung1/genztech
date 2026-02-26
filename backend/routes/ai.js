const express = require('express');
const axios   = require('axios');
const auth    = require('../middleware/auth');

const router = express.Router();
router.use(auth);

const OPENAI_URL = 'https://api.openai.com/v1/chat/completions';

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
      model:       'gpt-4.1-mini',
      messages:    [{ role: 'user', content: prompt }],
      temperature: 0.8,
      max_tokens:  1800,
    }, {
      headers: {
        'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
        'Content-Type':  'application/json',
      },
      timeout: 30000,
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
    res.status(500).json({ error: 'AI generation failed: ' + msg });
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
      model:       'gpt-4.1-mini',
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
    res.status(500).json({ error: 'Hashtag generation failed: ' + err.message });
  }
});

module.exports = router;
