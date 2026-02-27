const express = require('express');
const axios = require('axios');
const { authMiddleware } = require('../middleware/auth');

const router = express.Router();

// ─── Helper: gọi OpenAI ───────────────────────────────────────────────────────
async function callOpenAI(systemPrompt, userPrompt, maxTokens = 2000, jsonMode = true) {
  const openaiKey = process.env.OPENAI_API_KEY;
  const baseUrl = process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1';
  if (!openaiKey) throw new Error('Chưa cấu hình OPENAI_API_KEY trên server');

  const body = {
    model: 'gpt-4o-mini',
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt }
    ],
    max_tokens: maxTokens,
    temperature: 0.3
  };
  if (jsonMode) body.response_format = { type: 'json_object' };

  const r = await axios.post(`${baseUrl}/chat/completions`, body, {
    headers: { Authorization: `Bearer ${openaiKey}`, 'Content-Type': 'application/json' },
    timeout: 60000
  });
  return r.data.choices[0].message.content;
}

// ─── System prompt phân tích ngân sách (v2 - chuyên sâu theo ngành + dự báo) ──
const FB_ADS_SYSTEM_PROMPT_V2 = `Bạn là chuyên gia phân tích quảng cáo Facebook Ads và nhà khoa học dữ liệu với 10 năm kinh nghiệm tại Việt Nam. Nhiệm vụ: phân tích sâu, dự báo 3 tháng tới, đề xuất chiến lược cụ thể.

═══ BENCHMARKS THEO NGÀNH (Global 2025, quy đổi VNĐ ~25,000/USD) ═══

| Ngành | CTR tốt | CPM tốt | CR tốt | CAC tốt |
|---|---|---|---|---|
| Thời trang & Phụ kiện | >1.5% | <155,000đ | >1.0% | <540,000đ |
| Ẩm thực & Đồ uống | >0.9% | <190,000đ | >2.5% | <410,000đ |
| Sức khỏe & Làm đẹp | >1.0% | <225,000đ | >2.0% | <560,000đ |
| Nội thất & Gia dụng | >1.3% | <150,000đ | >0.7% | <380,000đ |
| Thể thao & Giải trí | >1.1% | <270,000đ | >0.5% | <600,000đ |
| Thú cưng | >1.0% | <140,000đ | >2.5% | <400,000đ |
| Giáo dục | >1.5% | <180,000đ | >3.0% | <500,000đ |
| Bất động sản | >0.8% | <300,000đ | >1.0% | <2,000,000đ |
| Dịch vụ tài chính | >0.7% | <350,000đ | >1.5% | <800,000đ |
| Công nghệ | >1.2% | <200,000đ | >1.5% | <700,000đ |

═══ BENCHMARKS CHUNG TẠI VIỆT NAM ═══

CPM: Tốt <70,000đ | TB 70,000–120,000đ | Cao >120,000đ
CTR: Tốt >2.0% | TB 1.0–2.0% | Thấp <1.0%
CPC: Tốt <4,000đ | TB 4,000–8,000đ | Cao >8,000đ
ROAS: Xuất sắc ≥4x | Tốt 3–4x | TB 2–3x | Yếu <2x
Cost/Message: Tốt <20,000đ | TB 20,000–40,000đ | Cao >40,000đ
Frequency: Bình thường 1.5–2.5 | Mỏi >3.0 | Cần làm mới >4.0

═══ QUY TẮC DỰ BÁO 3 THÁNG ═══

Giả định: Ngân sách không đổi. Nếu thực hiện đề xuất: CTR +5%/tháng, CVR +5%/tháng, CPM -3%/tháng.
- Tháng 2: ROAS = ROAS_T1 * 1.08 (cải thiện 8%)
- Tháng 3: ROAS = ROAS_T1 * 1.15 (cải thiện 15%)
- Tháng 4: ROAS = ROAS_T1 * 1.22 (cải thiện 22%)
- Doanh thu = Ngân sách tháng * ROAS dự báo
- CPA dự báo = CPA_T1 * (1 - 0.05 * tháng)

═══ QUY TẮC PHÂN TÍCH FUNNEL ═══
Impressions → CTR → Clicks → Landing Page → Add to Cart → Purchase
CTR cao + CVR thấp → vấn đề landing page / giá sản phẩm
CTR thấp → vấn đề creative / targeting
CPM cao → audience cạnh tranh / Relevance Score thấp

═══ ĐỊNH DẠNG OUTPUT (JSON CHÍNH XÁC) ═══

{
  "overview": {
    "status": "Tốt|Trung bình|Yếu kém",
    "score": 0-100,
    "summary": "Tóm tắt 3-4 câu cụ thể theo ngành, không chung chung"
  },
  "industry_context": "Nhận xét về đặc thù ngành và cách ảnh hưởng đến kết quả",
  "kpi_analysis": [
    {
      "kpi": "Tên chỉ số",
      "value": "Giá trị thực tế",
      "benchmark": "Benchmark ngành/VN",
      "status": "Tốt|Trung bình|Cần cải thiện",
      "comment": "Nhận xét cụ thể 1-2 câu, so sánh với ngành"
    }
  ],
  "strengths": ["Điểm mạnh cụ thể 1", "Điểm mạnh cụ thể 2"],
  "weaknesses": ["Điểm yếu cụ thể 1", "Điểm yếu cụ thể 2"],
  "recommendations": [
    {
      "priority": "Cao|Trung bình|Thấp",
      "title": "Tiêu đề hành động ngắn gọn",
      "description": "Mô tả chi tiết: làm gì, làm như thế nào, tại sao",
      "expected_impact": "Tác động dự kiến cụ thể (ví dụ: CTR tăng 20-30%)"
    }
  ],
  "forecast": {
    "summary": "Dự báo dựa trên dữ liệu thực tế và giả định thực hiện đề xuất",
    "monthly": [
      { "month": "Tháng hiện tại", "budget": 0, "revenue": 0, "roas": 0.0, "cpa": 0, "ctr": "0%", "label": "Thực tế" },
      { "month": "Tháng 2", "budget": 0, "revenue": 0, "roas": 0.0, "cpa": 0, "ctr": "0%", "label": "Dự báo" },
      { "month": "Tháng 3", "budget": 0, "revenue": 0, "roas": 0.0, "cpa": 0, "ctr": "0%", "label": "Dự báo" },
      { "month": "Tháng 4", "budget": 0, "revenue": 0, "roas": 0.0, "cpa": 0, "ctr": "0%", "label": "Dự báo" }
    ],
    "key_assumptions": ["Giả định 1", "Giả định 2"]
  }
}`;

// ─── System prompt phân tích đối thủ ─────────────────────────────────────────
const COMPETITOR_SYSTEM_PROMPT = `Bạn là chuyên gia phân tích cạnh tranh và chiến lược marketing digital với 10 năm kinh nghiệm. Nhiệm vụ: phân tích website/fanpage đối thủ từ nội dung HTML được cung cấp, so sánh với doanh nghiệp của người dùng.

═══ QUY TRÌNH PHÂN TÍCH ═══
1. Nhận diện: Loại hình kinh doanh, sản phẩm/dịch vụ chính, thị trường mục tiêu
2. Phân tích USP (Unique Selling Proposition): Điểm khác biệt, lợi thế cạnh tranh
3. Phân tích Marketing: Cách truyền thông, thông điệp, CTA, offer
4. Phân tích Website/Fanpage: UX, tốc độ, SEO cơ bản, social proof
5. So sánh với doanh nghiệp người dùng (nếu có thông tin)
6. Đề xuất chiến lược cạnh tranh

═══ ĐỊNH DẠNG OUTPUT (JSON CHÍNH XÁC) ═══

{
  "competitor_info": {
    "name": "Tên doanh nghiệp",
    "type": "Loại hình",
    "main_products": ["Sản phẩm/dịch vụ chính"],
    "target_market": "Thị trường mục tiêu",
    "price_range": "Phân khúc giá (Bình dân/Trung cấp/Cao cấp)"
  },
  "usp_analysis": {
    "main_usp": "USP chính của đối thủ",
    "messaging": "Thông điệp truyền thông chính",
    "offers": ["Offer/khuyến mãi nổi bật"]
  },
  "strengths": [
    { "point": "Điểm mạnh", "detail": "Giải thích chi tiết" }
  ],
  "weaknesses": [
    { "point": "Điểm yếu", "detail": "Giải thích chi tiết" }
  ],
  "marketing_analysis": {
    "social_presence": "Đánh giá hiện diện mạng xã hội",
    "content_strategy": "Chiến lược nội dung",
    "ad_strategy": "Chiến lược quảng cáo (nếu nhận diện được)"
  },
  "comparison": {
    "your_advantages": ["Lợi thế của bạn so với đối thủ"],
    "your_disadvantages": ["Bất lợi của bạn so với đối thủ"],
    "opportunities": ["Cơ hội để vượt qua đối thủ"]
  },
  "strategies": [
    {
      "priority": "Cao|Trung bình|Thấp",
      "title": "Chiến lược",
      "description": "Mô tả chi tiết cách thực hiện",
      "timeline": "Ngắn hạn (1-3 tháng)|Trung hạn (3-6 tháng)|Dài hạn (6-12 tháng)"
    }
  ],
  "overall_threat": "Thấp|Trung bình|Cao|Rất cao",
  "threat_summary": "Tóm tắt mức độ đe dọa và lý do"
}`;

// ─── POST /api/ai/generate ────────────────────────────────────────────────────
router.post('/generate', authMiddleware, async (req, res) => {
  try {
    const { prompt, type } = req.body;
    if (!prompt) return res.status(400).json({ error: 'Thiếu prompt' });

    const systemPrompt = type === 'caption'
      ? 'Bạn là chuyên gia viết caption quảng cáo Facebook bằng tiếng Việt. Viết caption hấp dẫn, ngắn gọn, có emoji phù hợp và call-to-action rõ ràng.'
      : 'Bạn là trợ lý AI hữu ích, trả lời bằng tiếng Việt một cách chuyên nghiệp và súc tích.';

    const result = await callOpenAI(systemPrompt, prompt, 800, false);
    res.json({ success: true, result });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ─── POST /api/ai/analyze-budget (v2 - chuyên sâu theo ngành + dự báo) ────────
router.post('/analyze-budget', async (req, res) => {
  try {
    const { metrics, industry, objective, currency, yourBusiness } = req.body;
    if (!metrics) return res.status(400).json({ error: 'Thiếu dữ liệu metrics' });

    const userPrompt = `Phân tích và dự báo chiến dịch quảng cáo Facebook sau:

Ngành: ${industry || 'Chưa xác định'}
Mục tiêu chiến dịch: ${objective || 'Chưa xác định'}
Đơn vị tiền tệ: ${currency || 'VNĐ'}
${yourBusiness ? `Thông tin doanh nghiệp: ${yourBusiness}` : ''}

DỮ LIỆU CHIẾN DỊCH (1 tháng thực tế):
${JSON.stringify(metrics, null, 2)}

Yêu cầu:
1. Phân tích từng KPI so với benchmark ngành "${industry}" cụ thể
2. Đưa ra nhận xét KHÔNG chung chung - phải cụ thể theo ngành và số liệu thực tế
3. Dự báo 3 tháng tới dựa trên dữ liệu này, tính toán cụ thể từng con số
4. Đề xuất hành động cụ thể, có thể thực hiện ngay`;

    const raw = await callOpenAI(FB_ADS_SYSTEM_PROMPT_V2, userPrompt, 2500, true);
    let analysis;
    try { analysis = JSON.parse(raw); } catch { analysis = { raw }; }
    res.json({ success: true, analysis });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ─── POST /api/ai/analyze-competitor ─────────────────────────────────────────
router.post('/analyze-competitor', async (req, res) => {
  try {
    const { competitorUrl, yourBusiness, industry } = req.body;
    if (!competitorUrl) return res.status(400).json({ error: 'Thiếu URL đối thủ' });

    // Scrape nội dung trang đối thủ
    let pageContent = '';
    try {
      const resp = await axios.get(competitorUrl, {
        timeout: 15000,
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'Accept-Language': 'vi-VN,vi;q=0.9,en-US;q=0.8'
        },
        maxRedirects: 5
      });

      // Trích xuất text từ HTML - loại bỏ script, style, nav
      const html = resp.data;
      pageContent = html
        .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
        .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
        .replace(/<nav[^>]*>[\s\S]*?<\/nav>/gi, '')
        .replace(/<footer[^>]*>[\s\S]*?<\/footer>/gi, '')
        .replace(/<[^>]+>/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        .substring(0, 6000); // Giới hạn 6000 ký tự để tránh vượt token
    } catch (scrapeErr) {
      // Nếu không scrape được, vẫn phân tích dựa trên URL và thông tin có sẵn
      pageContent = `Không thể truy cập trang web. URL: ${competitorUrl}. Lỗi: ${scrapeErr.message}`;
    }

    const userPrompt = `Phân tích đối thủ cạnh tranh sau:

URL đối thủ: ${competitorUrl}
Ngành: ${industry || 'Chưa xác định'}
${yourBusiness ? `Thông tin doanh nghiệp của tôi: ${yourBusiness}` : ''}

NỘI DUNG TRANG WEB ĐỐI THỦ:
${pageContent}

Hãy phân tích chi tiết đối thủ này và so sánh với doanh nghiệp của tôi (nếu có thông tin). Trả về JSON theo đúng định dạng đã quy định.`;

    const raw = await callOpenAI(COMPETITOR_SYSTEM_PROMPT, userPrompt, 2500, true);
    let analysis;
    try { analysis = JSON.parse(raw); } catch { analysis = { raw }; }
    res.json({ success: true, analysis, url: competitorUrl });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
