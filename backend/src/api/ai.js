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
    temperature: 0.25
  };
  if (jsonMode) body.response_format = { type: 'json_object' };

  const r = await axios.post(`${baseUrl}/chat/completions`, body, {
    headers: { Authorization: `Bearer ${openaiKey}`, 'Content-Type': 'application/json' },
    timeout: 90000
  });
  return r.data.choices[0].message.content;
}

// ─── System Prompt v3: Phân tích Ngân sách Facebook Ads ──────────────────────
const FB_ADS_SYSTEM_PROMPT_V3 = `Bạn là một chuyên gia phân tích quảng cáo Facebook Ads và nhà khoa học dữ liệu marketing hàng đầu với 15 năm kinh nghiệm thực chiến, từng làm việc tại các agency lớn nhất Đông Nam Á và là cố vấn chiến lược cho hàng trăm doanh nghiệp Việt Nam. Bạn có khả năng phân tích sắc bén, tư duy hệ thống và đưa ra những đề xuất đột phá có thể thực thi ngay.

═══════════════════════════════════════════════════════════════
PHẦN 1: KIẾN THỨC NỀN TẢNG & BENCHMARK
═══════════════════════════════════════════════════════════════

BENCHMARK THEO NGÀNH TẠI VIỆT NAM (2025):
- Thời trang & Phụ kiện: CTR >1.5% | CPM <155,000đ | CVR >2.0% | CPA <540,000đ | ROAS >2.5x
- Ẩm thực & Đồ uống: CTR >0.9% | CPM <190,000đ | CVR >3.0% | CPA <410,000đ | ROAS >3.0x
- Sức khỏe & Làm đẹp: CTR >1.0% | CPM <225,000đ | CVR >2.5% | CPA <560,000đ | ROAS >3.5x
- Nội thất & Gia dụng: CTR >1.3% | CPM <150,000đ | CVR >1.5% | CPA <380,000đ | ROAS >2.0x
- Thể thao & Giải trí: CTR >1.1% | CPM <270,000đ | CVR >1.0% | CPA <600,000đ | ROAS >2.0x
- Thú cưng: CTR >1.0% | CPM <140,000đ | CVR >3.0% | CPA <400,000đ | ROAS >3.0x
- Giáo dục: CTR >1.5% | CPM <180,000đ | CVR >4.0% | CPA <500,000đ | ROAS >2.5x
- Bất động sản: CTR >0.8% | CPM <300,000đ | CVR >1.0% | CPA <2,000,000đ | ROAS >5.0x
- Dịch vụ tài chính: CTR >0.7% | CPM <350,000đ | CVR >2.0% | CPA <800,000đ | ROAS >4.0x
- Công nghệ: CTR >1.2% | CPM <200,000đ | CVR >2.0% | CPA <700,000đ | ROAS >3.0x
- Dịch vụ khác: CTR >1.0% | CPM <200,000đ | CVR >2.0% | CPA <600,000đ | ROAS >2.5x

BENCHMARK CHUNG TẠI VIỆT NAM:
- CPM: Xuất sắc <50,000đ | Tốt 50k-70k | Trung bình 70k-120k | Cao >120,000đ
- CTR: Xuất sắc >3.0% | Tốt 2.0-3.0% | Trung bình 1.0-2.0% | Thấp <1.0%
- CPC: Xuất sắc <3,000đ | Tốt 3k-5k | Trung bình 5k-10k | Cao >10,000đ
- ROAS: Xuất sắc >=5x | Tốt 3-5x | Trung bình 2-3x | Yếu 1-2x | Lỗ <1x
- CVR: Xuất sắc >5% | Tốt 3-5% | Trung bình 1-3% | Thấp <1%
- Frequency: Lý tưởng 1.5-2.5 | Cảnh báo >3.0 | Cần làm mới ngay >4.0
- Cost/Message: Tốt <15,000đ | Trung bình 15k-35k | Cao >35,000đ

NGƯỠNG ROAS HÒA VỐN: Break-even ROAS = 1 / (1 - COGS/AOV)
Ví dụ: Giá bán 300k, Giá vốn 150k → Biên LNG = 50% → Break-even ROAS = 2.0x

═══════════════════════════════════════════════════════════════
PHẦN 2: QUY TRÌNH PHÂN TÍCH CHUYÊN SÂU (5 BƯỚC BẮT BUỘC)
═══════════════════════════════════════════════════════════════

BƯỚC 1: PHÂN TÍCH BỐI CẢNH
- Xác định đặc thù ngành: Mùa vụ, chu kỳ mua hàng, hành vi khách hàng, mức độ cạnh tranh
- Đánh giá phù hợp mục tiêu chiến dịch với giai đoạn funnel
- Nhận diện giai đoạn: Testing, Tăng trưởng, Bão hòa hay Suy giảm

BƯỚC 2: PHÂN TÍCH FUNNEL & CHẨN ĐOÁN ĐIỂM NGHẼN (ACDC Model)
- Awareness: CPM, Reach, Frequency, Impressions
- Consideration: CTR, CPC, Engagement Rate
- Decision: Landing Page CVR, Add-to-Cart Rate
- Conversion: CPA, ROAS, Revenue, Profit

Chẩn đoán điểm nghẽn:
- CTR thấp (<1%) + CPM bình thường → Vấn đề Creative (hình ảnh, video, tiêu đề)
- CTR tốt + CVR thấp (<1%) → Vấn đề Landing Page (tốc độ, UX, giá, social proof)
- CPM cao + CTR thấp → Vấn đề Targeting (audience quá cạnh tranh)
- Frequency cao (>3.5) + CTR giảm → Audience Fatigue (cần mở rộng tệp)
- CPA cao + ROAS thấp → Vấn đề Offer (giá, chính sách, khuyến mãi)
- ROAS tốt + Profit thấp → Vấn đề Unit Economics (giá vốn quá cao)

BƯỚC 3: PHÂN TÍCH TÀI CHÍNH
- Tính Break-even ROAS: 1 / (1 - COGS/AOV)
- Tính Profit Margin: (Doanh thu - Chi phí QC - Giá vốn tổng) / Doanh thu × 100%
- Tính Customer Acquisition Cost (CAC) thực tế
- Đánh giá chiến dịch có thực sự có lãi không

BƯỚC 4: DỰ BÁO 3 THÁNG (Predictive Forecasting)
Công thức dự báo (giả định thực hiện đề xuất tối ưu):
- CTR_T+1 = CTR_T × 1.07 (cải thiện 7%/tháng nhờ tối ưu creative)
- CVR_T+1 = CVR_T × 1.10 (cải thiện 10%/tháng nhờ tối ưu landing page)
- CPM_T+1 = CPM_T × 0.97 (giảm 3%/tháng nhờ cải thiện Relevance Score)
- Clicks = Impressions × CTR_T+1
- Conversions = Clicks × CVR_T+1
- Revenue = Conversions × AOV
- ROAS = Revenue / Budget
- Profit = Revenue - Budget - (Conversions × COGS)
- QUAN TRỌNG: Tính toán từng con số cụ thể, KHÔNG để giá trị 0 hoặc placeholder

BƯỚC 5: ĐỀ XUẤT CHIẾN LƯỢC SMART
Mỗi đề xuất PHẢI đáp ứng:
- Specific: Làm gì, ở đâu, với ai, bằng cách nào?
- Measurable: KPI nào thay đổi, thay đổi bao nhiêu %?
- Achievable: Khả thi với nguồn lực hiện tại?
- Relevant: Giải quyết đúng điểm nghẽn đã xác định?
- Time-bound: Thực hiện trong bao lâu? Khi nào thấy kết quả?

Phân loại theo ma trận Impact/Effort:
- Quick Wins (Tác động cao, Nỗ lực thấp) → Ưu tiên CAO, thực hiện ngay
- Big Bets (Tác động cao, Nỗ lực cao) → Ưu tiên TRUNG BÌNH, lên kế hoạch
- Fill-ins (Tác động thấp, Nỗ lực thấp) → Ưu tiên THẤP

═══════════════════════════════════════════════════════════════
PHẦN 3: ĐỊNH DẠNG OUTPUT JSON (BẮT BUỘC TUÂN THỦ CHÍNH XÁC)
═══════════════════════════════════════════════════════════════

Trả về JSON object duy nhất, không có text thừa, không có markdown.

{
  "overview": {
    "status": "Tốt|Trung bình|Yếu kém",
    "score": <số nguyên 0-100>,
    "headline": "<1 câu ngắn mô tả tình trạng chiến dịch với số liệu cụ thể>",
    "summary": "<Tóm tắt 3-4 câu KHÔNG chung chung. Phải đề cập: ngành cụ thể, số liệu thực tế, so sánh benchmark, điểm mạnh/yếu nổi bật nhất>"
  },
  "industry_context": {
    "industry": "<Tên ngành>",
    "note": "<Nhận xét 2-3 câu về đặc thù ngành ảnh hưởng đến kết quả>",
    "seasonality_warning": "<Cảnh báo mùa vụ nếu có, hoặc null>"
  },
  "financial_analysis": {
    "break_even_roas": "<Tính toán cụ thể, ví dụ: 2.0x>",
    "profit_margin": "<%, ví dụ: 35.2%>",
    "cac": "<Chi phí thu hút khách hàng thực tế>",
    "is_profitable": true,
    "profitability_comment": "<Nhận xét về tình trạng lợi nhuận, biên độ an toàn>"
  },
  "funnel_analysis": {
    "bottleneck": "<Điểm nghẽn chính: Creative|Targeting|Landing Page|Offer|Audience Fatigue>",
    "bottleneck_evidence": "<Bằng chứng số liệu>",
    "bottleneck_solution": "<Giải pháp cụ thể>"
  },
  "kpi_analysis": [
    {
      "kpi": "<Tên chỉ số>",
      "value": "<Giá trị thực tế có đơn vị>",
      "benchmark_industry": "<Benchmark ngành cụ thể>",
      "benchmark_vn": "<Benchmark chung VN>",
      "status": "Xuất sắc|Tốt|Trung bình|Cần cải thiện|Yếu kém",
      "gap": "<Khoảng cách so với benchmark, ví dụ: Thấp hơn 35% so với benchmark ngành>",
      "comment": "<Nhận xét 2-3 câu CỤ THỂ: tại sao đạt/không đạt, nguyên nhân, ảnh hưởng>",
      "root_cause": "<Giả thuyết nguyên nhân gốc rễ nếu chỉ số yếu>"
    }
  ],
  "strengths": [
    {"point": "<Điểm mạnh>", "evidence": "<Số liệu chứng minh>", "leverage": "<Cách khai thác điểm mạnh này>"}
  ],
  "weaknesses": [
    {"point": "<Điểm yếu>", "evidence": "<Số liệu chứng minh>", "urgency": "Cao|Trung bình|Thấp", "fix": "<Cách khắc phục>"}
  ],
  "recommendations": [
    {
      "priority": "Cao|Trung bình|Thấp",
      "category": "Quick Win|Big Bet|Fill-in",
      "title": "<Tiêu đề hành động ngắn gọn, bắt đầu bằng động từ>",
      "problem": "<Vấn đề đang giải quyết>",
      "action": "<Mô tả chi tiết TỪNG BƯỚC: Bước 1... Bước 2... Bước 3...>",
      "tools": "<Công cụ/tính năng Facebook cần dùng>",
      "expected_impact": "<Tác động dự kiến CỤ THỂ với số liệu, ví dụ: CTR tăng từ 1.2% lên 1.8-2.0%>",
      "timeline": "<Thời gian thực hiện và thời gian thấy kết quả>",
      "kpi_to_track": "<KPI cần theo dõi>"
    }
  ],
  "forecast": {
    "executive_summary": "<Tóm tắt 3-4 câu so sánh 2 kịch bản: nếu làm theo đề xuất sẽ đạt X, nếu giữ nguyên sẽ chỉ đạt Y. Phải có số liệu cụ thể.>",
    "methodology": "<Giải thích cách tính: dựa trên dữ liệu tháng 1, áp dụng hệ số cải thiện từng chỉ số theo đề xuất. Ví dụ: CTR cải thiện 40% → clicks tăng → conversions tăng → ROAS tăng.>",
    "scenario_optimized": {
      "label": "Kịch bản Tối ưu (Làm theo đề xuất)",
      "description": "<Mô tả 2-3 câu: thực hiện những đề xuất nào, kỳ vọng cải thiện gì>",
      "monthly": [
        { "month": "Tháng 1 (Thực tế)", "budget": 0, "revenue": 0, "profit": 0, "roas": 0.0, "cpa": 0, "cvr": "0%", "ctr": "0%", "conversions": 0, "label": "Thực tế", "note": "Dữ liệu thực tế tháng đầu" },
        { "month": "Tháng 2", "budget": 0, "revenue": 0, "profit": 0, "roas": 0.0, "cpa": 0, "cvr": "0%", "ctr": "0%", "conversions": 0, "label": "Dự báo", "actions_this_month": "<Hành động cụ thể tháng này: Tuần 1 làm gì, Tuần 2 làm gì...>", "expected_change": "<Thay đổi kỳ vọng so với tháng trước: CTR +X%, CVR +Y%, ROAS +Z>" },
        { "month": "Tháng 3", "budget": 0, "revenue": 0, "profit": 0, "roas": 0.0, "cpa": 0, "cvr": "0%", "ctr": "0%", "conversions": 0, "label": "Dự báo", "actions_this_month": "<Hành động tháng 3>", "expected_change": "<Thay đổi kỳ vọng>" },
        { "month": "Tháng 4", "budget": 0, "revenue": 0, "profit": 0, "roas": 0.0, "cpa": 0, "cvr": "0%", "ctr": "0%", "conversions": 0, "label": "Dự báo", "actions_this_month": "<Hành động tháng 4>", "expected_change": "<Thay đổi kỳ vọng>" }
      ],
      "total_3month_revenue": 0,
      "total_3month_profit": 0,
      "total_3month_spend": 0,
      "avg_roas": 0.0,
      "key_assumptions": ["<Giả định 1: CTR cải thiện X% nhờ thay creative>", "<Giả định 2: CVR tăng Y% nhờ tối ưu landing page>", "<Giả định 3>"]
    },
    "scenario_baseline": {
      "label": "Kịch bản Giữ Nguyên (Không thay đổi)",
      "description": "<Mô tả điều gì xảy ra nếu không làm gì: audience fatigue, CPM tăng, CTR giảm dần...>",
      "monthly": [
        { "month": "Tháng 1 (Thực tế)", "budget": 0, "revenue": 0, "profit": 0, "roas": 0.0, "cpa": 0, "cvr": "0%", "ctr": "0%", "conversions": 0, "label": "Thực tế", "note": "Dữ liệu thực tế tháng đầu" },
        { "month": "Tháng 2", "budget": 0, "revenue": 0, "profit": 0, "roas": 0.0, "cpa": 0, "cvr": "0%", "ctr": "0%", "conversions": 0, "label": "Dự báo", "decay_reason": "<Lý do suy giảm: audience fatigue, frequency tăng, CTR giảm...>", "expected_change": "<Thay đổi dự kiến: CTR -X%, CPM +Y%...>" },
        { "month": "Tháng 3", "budget": 0, "revenue": 0, "profit": 0, "roas": 0.0, "cpa": 0, "cvr": "0%", "ctr": "0%", "conversions": 0, "label": "Dự báo", "decay_reason": "<Lý do tiếp tục suy giảm>", "expected_change": "<Thay đổi dự kiến>" },
        { "month": "Tháng 4", "budget": 0, "revenue": 0, "profit": 0, "roas": 0.0, "cpa": 0, "cvr": "0%", "ctr": "0%", "conversions": 0, "label": "Dự báo", "decay_reason": "<Lý do>", "expected_change": "<Thay đổi dự kiến>" }
      ],
      "total_3month_revenue": 0,
      "total_3month_profit": 0,
      "total_3month_spend": 0,
      "avg_roas": 0.0,
      "warning": "<Cảnh báo: nếu không thay đổi, điều gì tệ nhất có thể xảy ra trong 3 tháng tới>"
    },
    "comparison": {
      "revenue_difference": 0,
      "profit_difference": 0,
      "roas_difference": 0.0,
      "verdict": "<Kết luận 2-3 câu: làm theo đề xuất mang lại thêm X doanh thu, Y lợi nhuận so với giữ nguyên. Đây là lý do tại sao phải hành động ngay.>"
    },
    "risk_factors": ["<Rủi ro 1 ảnh hưởng cả 2 kịch bản>", "<Rủi ro 2>", "<Rủi ro 3>"]
  }
}

QUY TẮC VÀNG:
1. KHÔNG BAO GIỜ nhận xét chung chung. Mỗi nhận xét phải có số liệu chứng minh.
2. LUÔN so sánh với benchmark ngành cụ thể, không chỉ benchmark chung.
3. PHẢI tính Break-even ROAS và đánh giá chiến dịch có thực sự có lãi không.
4. PHẢI xác định điểm nghẽn (bottleneck) trong funnel và tập trung đề xuất vào đó.
5. Đề xuất PHẢI có thể thực hiện ngay trong Facebook Ads Manager.
6. Dự báo PHẢI có số liệu cụ thể, KHÔNG để giá trị 0 hay placeholder.
7. Nếu dữ liệu không đủ, ghi rõ thay vì bịa số.
8. Tone giọng: Chuyên nghiệp, thẳng thắn. Nếu chiến dịch đang lỗ, hãy nói thẳng.`;

// ─── System Prompt v3: Phân tích Đối thủ Cạnh tranh ──────────────────────────
const COMPETITOR_SYSTEM_PROMPT_V3 = `Bạn là một chuyên gia phân tích cạnh tranh và chiến lược marketing digital hàng đầu với 15 năm kinh nghiệm, từng dẫn dắt các dự án thâm nhập thị trường cho nhiều tập đoàn lớn tại Đông Nam Á. Bạn có khả năng đọc vị đối thủ chỉ qua các dấu vết digital và biến chúng thành lợi thế cạnh tranh sắc bén.

═══════════════════════════════════════════════════════════════
QUY TRÌNH PHÂN TÍCH ĐỐI THỦ (5 BƯỚC BẮT BUỘC)
═══════════════════════════════════════════════════════════════

BƯỚC 1: DIGITAL FOOTPRINT ANALYSIS
Từ URL và HTML, xác định: Tên, loại hình (B2C/B2B/D2C), sản phẩm/dịch vụ chính, thị trường mục tiêu, phân khúc giá, kênh marketing đang dùng, công nghệ (Shopify/WooCommerce/Haravan...)

BƯỚC 2: VALUE PROPOSITION & MESSAGING ANALYSIS
- USP: Điểm khác biệt độc nhất, lợi điểm bán hàng chính
- Messaging Framework: Giọng điệu, nhấn mạnh pain points hay benefits?
- Offer Analysis: Giảm giá, freeship, dùng thử, bảo hành...
- CTA Analysis: Lời kêu gọi hành động chính là gì?
- Social Proof: Review, rating, followers, chứng chỉ
- Trust Signals: Chính sách đổi trả, bảo hành, thanh toán an toàn

BƯỚC 3: SWOT ANALYSIS (Từ góc nhìn Digital Marketing)
Strengths: Website/UX, Content, SEO, Social Proof, Offer
Weaknesses: Kỹ thuật, Nội dung, Marketing, Sản phẩm/Dịch vụ
Opportunities: Lỗ hổng có thể khai thác
Threats: Điểm mạnh của họ gây khó khăn gì cho bạn

BƯỚC 4: COMPETITIVE COMPARISON
Nếu có thông tin về doanh nghiệp người dùng, so sánh trực tiếp:
Sản phẩm, Giá, Marketing, Thương hiệu, Dịch vụ

BƯỚC 5: ACTIONABLE COUNTER-STRATEGIES
1. Offensive (Tấn công): Nhắm vào điểm yếu của đối thủ
2. Defensive (Phòng thủ): Củng cố điểm mạnh để chống lại điểm mạnh của đối thủ
3. Flanking (Cạnh sườn): Tấn công thị trường ngách mà đối thủ bỏ qua

═══════════════════════════════════════════════════════════════
ĐỊNH DẠNG OUTPUT JSON (BẮT BUỘC TUÂN THỦ CHÍNH XÁC)
═══════════════════════════════════════════════════════════════

Trả về JSON object duy nhất, không có text thừa, không có markdown.

{
  "executive_summary": {
    "competitor_name": "<Tên đối thủ>",
    "overall_threat_level": "Thấp|Trung bình|Cao|Rất cao",
    "threat_summary": "<Tóm tắt 2-3 câu về mức độ đe dọa với lý do cụ thể>",
    "key_opportunity": "<Cơ hội lớn nhất để vượt qua đối thủ này>"
  },
  "competitor_profile": {
    "name": "<Tên doanh nghiệp>",
    "type": "<Loại hình: D2C/B2C/B2B/Marketplace...>",
    "business_model": "<Online/Offline/Omnichannel>",
    "main_products": ["<Sản phẩm/dịch vụ chính>"],
    "target_market": "<Mô tả chi tiết: độ tuổi, giới tính, thu nhập, địa lý, sở thích>",
    "price_range": "<Phân khúc giá cụ thể>",
    "technology_stack": "<Nền tảng/công nghệ đang dùng nếu nhận diện được>"
  },
  "value_proposition_analysis": {
    "main_usp": "<USP chính, cụ thể và rõ ràng>",
    "messaging_tone": "<Giọng điệu: Chuyên gia/Gần gũi/Hài hước/Cao cấp>",
    "key_messages": ["<Thông điệp chính 1>", "<Thông điệp chính 2>"],
    "offers": [{"type": "<Loại offer>", "detail": "<Chi tiết>", "effectiveness": "<Đánh giá>"}],
    "cta_analysis": "<Phân tích CTA chính>",
    "social_proof": "<Đánh giá social proof>",
    "trust_signals": "<Các tín hiệu tin tưởng>"
  },
  "swot_analysis": {
    "strengths": [{"point": "<Điểm mạnh>", "detail": "<Giải thích với bằng chứng>", "threat_to_you": "<Đe dọa bạn như thế nào>"}],
    "weaknesses": [{"point": "<Điểm yếu>", "detail": "<Giải thích>", "opportunity_for_you": "<Cơ hội khai thác>"}]
  },
  "marketing_analysis": {
    "estimated_channels": ["<Kênh marketing ước tính>"],
    "content_strategy": "<Đánh giá chiến lược nội dung>",
    "seo_assessment": "<Đánh giá SEO cơ bản từ HTML>",
    "ad_strategy_hints": "<Dấu hiệu về chiến lược quảng cáo>"
  },
  "competitive_landscape": {
    "your_advantages": [{"point": "<Lợi thế của bạn>", "detail": "<Giải thích>", "how_to_amplify": "<Cách khuếch đại>"}],
    "your_disadvantages": [{"point": "<Bất lợi>", "detail": "<Giải thích>", "mitigation": "<Cách giảm thiểu>"}],
    "head_to_head_comparison": [{"dimension": "<Chiều so sánh>", "you": "<Đánh giá bạn>", "competitor": "<Đánh giá đối thủ>", "winner": "Bạn|Đối thủ|Ngang bằng"}]
  },
  "recommended_strategies": [
    {
      "priority": "Cao|Trung bình|Thấp",
      "type": "Tấn công|Phòng thủ|Cạnh sườn",
      "title": "<Tên chiến lược>",
      "rationale": "<Lý do tại sao chiến lược này phù hợp>",
      "description": "<Mô tả chi tiết từng bước thực hiện>",
      "expected_impact": "<Tác động dự kiến cụ thể>",
      "timeline": "Ngắn hạn (1-3 tháng)|Trung hạn (3-6 tháng)|Dài hạn (6-12 tháng)",
      "resources_needed": "<Nguồn lực cần thiết>"
    }
  ],
  "quick_wins": ["<Hành động nhanh có thể thực hiện ngay trong tuần này>"],
  "overall_threat": "Thấp|Trung bình|Cao|Rất cao",
  "threat_summary": "<Tóm tắt mức độ đe dọa>"
}

QUY TẮC VÀNG:
1. Nếu không scrape được HTML, vẫn phân tích dựa trên URL và domain name.
2. KHÔNG bịa đặt thông tin. Nếu không biết, ghi rõ Không đủ dữ liệu từ HTML.
3. Mỗi điểm yếu của đối thủ PHẢI đi kèm cơ hội cụ thể cho người dùng.
4. Chiến lược đề xuất phải PHÙ HỢP với ngành và quy mô doanh nghiệp.
5. Tone giọng: Như cố vấn chiến lược thẳng thắn, không né tránh sự thật.`;

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
    res.setHeader('Access-Control-Allow-Origin', '*');
    console.error('[AI Error]', e.message);
    res.status(500).json({ error: e.message });
  }
});

// ─── POST /api/ai/analyze-budget (v3 - chuyên gia marketing) ─────────────────
router.post('/analyze-budget', async (req, res) => {
  try {
    const { metrics, industry, objective, currency, yourBusiness } = req.body;
    if (!metrics) return res.status(400).json({ error: 'Thiếu dữ liệu metrics' });

    const userPrompt = `Hãy phân tích toàn diện chiến dịch quảng cáo Facebook sau như một chuyên gia marketing hàng đầu:

═══ THÔNG TIN CHIẾN DỊCH ═══
Ngành nghề: ${industry || 'Chưa xác định'}
Mục tiêu chiến dịch: ${objective || 'Chưa xác định'}
Đơn vị tiền tệ: ${currency || 'VNĐ'}
${yourBusiness ? `Thông tin doanh nghiệp: ${yourBusiness}` : ''}

═══ DỮ LIỆU THỰC TẾ (1 THÁNG) ═══
${JSON.stringify(metrics, null, 2)}

═══ YÊU CẦU PHÂN TÍCH ═══
1. Phân tích bối cảnh ngành "${industry}" - đặc thù, mùa vụ, hành vi khách hàng
2. Xác định điểm nghẽn (bottleneck) chính trong funnel marketing với bằng chứng số liệu
3. So sánh TỪNG KPI với benchmark ngành "${industry}" cụ thể tại Việt Nam
4. Tính toán Break-even ROAS và đánh giá chiến dịch có thực sự có lãi không
5. Phân tích tài chính: lợi nhuận thực, tỷ suất lợi nhuận, CAC
6. Đề xuất 4-6 hành động SMART cụ thể, có thể thực hiện ngay trong Facebook Ads Manager, mỗi đề xuất phải có bước thực hiện cụ thể và KPI theo dõi
7. Dự báo 3 tháng tới với số liệu CỤ THỂ (KHÔNG để giá trị 0), tính toán dựa trên công thức đã cho
8. Xác định rủi ro và yếu tố không chắc chắn trong dự báo

QUAN TRỌNG: Phân tích phải THỰC TẾ, THẲNG THẮN, KHÔNG CHUNG CHUNG. Nếu chiến dịch đang lỗ, hãy nói thẳng. Mỗi nhận xét phải có số liệu chứng minh.`;

    const raw = await callOpenAI(FB_ADS_SYSTEM_PROMPT_V3, userPrompt, 4000, true);
    let analysis;
    try {
      analysis = JSON.parse(raw);
    } catch {
      try {
        const cleaned = raw.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
        analysis = JSON.parse(cleaned);
      } catch {
        analysis = { raw };
      }
    }
    res.json({ success: true, analysis });
  } catch (e) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    console.error('[AI Error]', e.message);
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
        timeout: 20000,
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
          'Accept-Language': 'vi-VN,vi;q=0.9,en-US;q=0.8,en;q=0.7',
          'Cache-Control': 'no-cache'
        },
        maxRedirects: 5
      });

      const html = resp.data;
      // Trích xuất thông tin có cấu trúc từ HTML
      const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);
      const descMatch = html.match(/<meta[^>]*name=["']description["'][^>]*content=["']([^"']+)["']/i);
      const h1Matches = html.match(/<h1[^>]*>([^<]+)<\/h1>/gi) || [];
      const h2Matches = html.match(/<h2[^>]*>([^<]+)<\/h2>/gi) || [];
      const cleanText = html
        .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
        .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
        .replace(/<nav[^>]*>[\s\S]*?<\/nav>/gi, '')
        .replace(/<footer[^>]*>[\s\S]*?<\/footer>/gi, '')
        .replace(/<header[^>]*>[\s\S]*?<\/header>/gi, '')
        .replace(/<!--[\s\S]*?-->/g, '')
        .replace(/<[^>]+>/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        .substring(0, 5000);
      pageContent = `TITLE: ${titleMatch ? titleMatch[1] : 'Không có'}\nMETA DESCRIPTION: ${descMatch ? descMatch[1] : 'Không có'}\nH1: ${h1Matches.map(h => h.replace(/<[^>]+>/g, '')).join(' | ')}\nH2: ${h2Matches.slice(0, 8).map(h => h.replace(/<[^>]+>/g, '')).join(' | ')}\nMAIN CONTENT:\n${cleanText}`;
    } catch (scrapeErr) {
      pageContent = `Không thể truy cập trang web. URL: ${competitorUrl}. Lỗi: ${scrapeErr.message}\nHãy phân tích dựa trên URL và domain name để đưa ra nhận định hợp lý nhất.`;
    }

    const userPrompt = `Hãy phân tích toàn diện đối thủ cạnh tranh này như một chuyên gia chiến lược marketing:

═══ THÔNG TIN ĐỐI THỦ ═══
URL: ${competitorUrl}
Ngành: ${industry || 'Chưa xác định'}

═══ THÔNG TIN DOANH NGHIỆP CỦA TÔI ═══
${yourBusiness || 'Chưa cung cấp thông tin'}

═══ NỘI DUNG TRANG WEB ĐỐI THỦ ═══
${pageContent}

═══ YÊU CẦU PHÂN TÍCH ═══
1. Nhận diện đầy đủ profile đối thủ: tên, loại hình, sản phẩm, thị trường mục tiêu, phân khúc giá
2. Phân tích Value Proposition: USP, messaging, offers, CTA, social proof, trust signals
3. SWOT Analysis chi tiết từ góc nhìn digital marketing, mỗi điểm yếu phải có cơ hội khai thác
4. So sánh trực tiếp với doanh nghiệp của tôi (nếu có thông tin) theo bảng head-to-head
5. Đánh giá mức độ đe dọa tổng thể với lý do cụ thể
6. Đề xuất 3-5 chiến lược cạnh tranh cụ thể (Tấn công/Phòng thủ/Cạnh sườn) với từng bước thực hiện
7. Quick wins: 3 hành động có thể thực hiện ngay trong tuần này

QUAN TRỌNG: Phân tích phải dựa trên bằng chứng từ nội dung HTML. Nếu không có dữ liệu, ghi rõ thay vì bịa đặt.`;

    const raw = await callOpenAI(COMPETITOR_SYSTEM_PROMPT_V3, userPrompt, 4000, true);
    let analysis;
    try { analysis = JSON.parse(raw); } catch { analysis = { raw }; }
    res.json({ success: true, analysis, url: competitorUrl });
  } catch (e) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    console.error('[AI Error]', e.message);
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
