const express = require('express');
const axios = require('axios');
const { authMiddleware } = require('../middleware/auth');

const router = express.Router();

// ─── System prompt chuyên sâu Facebook Ads ───────────────────────────────────
const FB_ADS_SYSTEM_PROMPT = `Bạn là chuyên gia phân tích quảng cáo Facebook Ads với 10 năm kinh nghiệm tại thị trường Việt Nam, đặc biệt trong lĩnh vực eCommerce, Giáo dục và Dịch vụ.

BENCHMARKS CHUẨN TẠI VIỆT NAM:

CPM (Chi phí 1,000 lần hiển thị):
- Tốt: < 70,000 VNĐ | Trung bình: 70,000–120,000 VNĐ | Cao: > 120,000 VNĐ

CTR (Tỷ lệ nhấp):
- Tốt: > 2.0% | Trung bình: 1.0–2.0% | Thấp: < 1.0%

CPC (Chi phí mỗi nhấp):
- Tốt: < 4,000 VNĐ | Trung bình: 4,000–8,000 VNĐ | Cao: > 8,000 VNĐ

ROAS (eCommerce):
- Xuất sắc: ≥ 4x | Tốt: 3–4x | Trung bình: 2–3x | Yếu: < 2x

CPA / Cost per Message:
- Tin nhắn: Tốt < 20,000 VNĐ | Trung bình 20,000–40,000 VNĐ | Cao > 40,000 VNĐ
- Mua hàng: CPA tốt nên < 30% AOV (giá trị đơn hàng trung bình)

Ngân sách ngày:
- Tối thiểu để thoát learning phase: 150,000–200,000 VNĐ/ngày
- Khuyến nghị: ≥ 500,000 VNĐ/ngày

Frequency (Tần suất):
- Bình thường: 1.5–2.5 | Bắt đầu mỏi: > 3.0 | Cần làm mới creative ngay: > 4.0

QUY TẮC PHÂN TÍCH FUNNEL:
Impressions → CTR → Clicks → Landing Page Views → Add to Cart → Purchase
Nếu CTR cao nhưng CVR thấp → vấn đề ở landing page hoặc giá sản phẩm.
Nếu CTR thấp → vấn đề ở creative hoặc targeting.
Nếu CPM cao → audience quá cạnh tranh hoặc Relevance Score thấp.

CHIẾN LƯỢC SCALE:
- Scale ngang: Duplicate ad set, thử audience mới
- Scale dọc: Tăng ngân sách tối đa 20–30%/ngày để tránh reset learning
- Scale theo giờ: Tập trung ngân sách vào khung giờ vàng (7–9h, 11–13h, 20–22h)

ĐỊNH DẠNG OUTPUT: Trả về JSON hợp lệ duy nhất, không có text bên ngoài. Cấu trúc:
{
  "overview": {
    "status": "Tốt" | "Trung bình" | "Yếu kém",
    "score": 0-100,
    "summary": "Tóm tắt 2-3 câu về tình hình tổng quan"
  },
  "kpi_analysis": [
    {
      "kpi": "Tên chỉ số",
      "value": "Giá trị thực tế",
      "benchmark": "Benchmark chuẩn",
      "status": "Tốt" | "Trung bình" | "Cần cải thiện",
      "comment": "Nhận xét ngắn gọn 1-2 câu"
    }
  ],
  "strengths": ["Điểm mạnh 1", "Điểm mạnh 2"],
  "weaknesses": ["Điểm yếu 1", "Điểm yếu 2"],
  "recommendations": [
    {
      "priority": "Cao" | "Trung bình" | "Thấp",
      "title": "Tiêu đề hành động",
      "description": "Mô tả chi tiết cách thực hiện và lý do tại sao",
      "expected_impact": "Tác động dự kiến"
    }
  ]
}`;

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

// POST /api/ai/analyze-budget  ← Endpoint mới phân tích ngân sách quảng cáo
router.post('/analyze-budget', async (req, res) => {
  try {
    const { metrics, industry, objective, currency } = req.body;
    if (!metrics) return res.status(400).json({ error: 'Thiếu dữ liệu metrics' });

    const openaiKey = process.env.OPENAI_API_KEY;
    if (!openaiKey) return res.status(500).json({ error: 'Chưa cấu hình OPENAI_API_KEY trên server' });

    // Xây dựng user prompt từ dữ liệu thực tế
    const userPrompt = `Phân tích chiến dịch quảng cáo Facebook sau đây:

Ngành: ${industry || 'Chưa xác định'}
Mục tiêu chiến dịch: ${objective || 'Chưa xác định'}
Đơn vị tiền tệ: ${currency || 'VNĐ'}

DỮ LIỆU CHIẾN DỊCH:
${JSON.stringify(metrics, null, 2)}

Hãy phân tích chi tiết và đưa ra nhận xét, đề xuất cụ thể theo định dạng JSON đã quy định.`;

    const r = await axios.post('https://api.openai.com/v1/chat/completions', {
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: FB_ADS_SYSTEM_PROMPT },
        { role: 'user', content: userPrompt }
      ],
      max_tokens: 2000,
      temperature: 0.3,
      response_format: { type: 'json_object' }
    }, {
      headers: { Authorization: `Bearer ${openaiKey}`, 'Content-Type': 'application/json' },
      timeout: 45000
    });

    let analysis;
    try {
      analysis = JSON.parse(r.data.choices[0].message.content);
    } catch {
      analysis = { raw: r.data.choices[0].message.content };
    }

    res.json({ success: true, analysis });
  } catch (e) {
    const msg = e.response?.data?.error?.message || e.message;
    res.status(500).json({ error: msg });
  }
});

module.exports = router;
