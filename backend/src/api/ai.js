const express = require('express');
const axios = require('axios');
const { authMiddleware } = require('../middleware/auth');

const router = express.Router();

// POST /api/ai/generate
router.post('/generate', authMiddleware, async (req, res) => {
  try {
    const { prompt, type } = req.body;
    if (!prompt) return res.status(400).json({ error: 'Thiếu prompt' });

    const openaiKey = process.env.OPENAI_API_KEY;
    if (!openaiKey) return res.status(500).json({ error: 'Chưa cấu hình OPENAI_API_KEY trên server' });

    const systemPrompt = type === 'caption'
      ? 'Bạn là chuyên gia viết caption quảng cáo Facebook bằng tiếng Việt. Viết caption hấp dẫn, ngắn gọn, có emoji phù hợp và call-to-action rõ ràng.'
      : 'Bạn là trợ lý AI hữu ích, trả lời bằng tiếng Việt một cách chuyên nghiệp và súc tích.';

    const r = await axios.post('https://api.openai.com/v1/chat/completions', {
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: prompt }
      ],
      max_tokens: 800,
      temperature: 0.8
    }, {
      headers: { Authorization: `Bearer ${openaiKey}`, 'Content-Type': 'application/json' },
      timeout: 30000
    });

    res.json({ success: true, result: r.data.choices[0].message.content });
  } catch (e) {
    const msg = e.response?.data?.error?.message || e.message;
    res.status(500).json({ error: msg });
  }
});

module.exports = router;
