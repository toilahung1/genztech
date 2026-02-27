# GenzTech Backend API

Backend server cho GenzTech - hệ thống quản lý quảng cáo Facebook.

## Deploy lên Railway

1. Fork/clone repo này
2. Tạo project mới trên Railway
3. Connect GitHub repo
4. Thêm các environment variables (xem `.env.example`)
5. Deploy

## API Routes

### Auth
- `POST /api/auth/register` - Đăng ký
- `POST /api/auth/login` - Đăng nhập
- `GET /api/auth/me` - Lấy thông tin user hiện tại

### Facebook
- `GET /api/facebook/status` - Kiểm tra kết nối FB
- `POST /api/facebook/sync` - Lưu FB token
- `POST /api/facebook/disconnect` - Ngắt kết nối FB
- `GET /api/facebook/oauth/url` - Lấy OAuth URL

### Facebook Proxy (cần JWT)
- `GET /api/facebook/proxy/my-ad-accounts` - Lấy danh sách TKQC
- `GET /api/facebook/proxy/ad-account/:id` - Lấy campaigns của TKQC
- `POST /api/facebook/proxy/pause-campaigns` - Tạm dừng campaigns

### Posts
- `POST /api/facebook/post` - Đăng bài
- `POST /api/posts/schedule` - Lên lịch đăng bài

### AI
- `POST /api/ai/generate` - Tạo nội dung bằng AI
