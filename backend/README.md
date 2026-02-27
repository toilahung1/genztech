# GenzTech Backend v2.0

Backend API server cho hệ thống GenzTech — quản lý quảng cáo Facebook và tự động đăng bài.

## Công nghệ

- **Runtime:** Node.js 18+
- **Framework:** Express.js
- **Database:** PostgreSQL (Prisma ORM)
- **Auth:** JWT
- **Deploy:** Railway

## Cài đặt local

```bash
# 1. Clone và cài dependencies
npm install

# 2. Copy file env
cp .env.example .env
# Điền các giá trị vào .env

# 3. Khởi tạo database
npx prisma db push

# 4. Chạy server
npm run dev
```

## Deploy lên Railway

1. Push code lên GitHub
2. Vào [railway.app](https://railway.app) → New Project → Deploy from GitHub repo
3. Thêm PostgreSQL service (Add Service → Database → PostgreSQL)
4. Vào service backend → Variables → thêm các biến từ `.env.example`
5. Railway tự động deploy

## API Routes

| Route | Method | Auth | Mô tả |
|---|---|---|---|
| `/health` | GET | | Health check |
| `/api/auth/register` | POST | | Đăng ký |
| `/api/auth/login` | POST | | Đăng nhập |
| `/api/auth/me` | GET | JWT | Thông tin user |
| `/api/facebook/oauth/url` | GET | | Lấy URL OAuth |
| `/api/facebook/status` | GET | JWT | Trạng thái kết nối FB |
| `/api/facebook/sync` | POST | JWT | Lưu FB token |
| `/api/facebook/disconnect` | POST | JWT | Ngắt kết nối |
| `/api/facebook/refresh` | POST | JWT | Gia hạn token |
| `/api/facebook/post` | POST | JWT | Đăng bài ngay |
| `/api/facebook/upload-media` | POST | JWT | Upload media |
| `/api/facebook/check-cookie` | POST | | Kiểm tra cookie |
| `/api/facebook/proxy/my-ad-accounts` | GET | JWT | Danh sách TKQC |
| `/api/facebook/proxy/ad-account/:id` | GET | JWT | Campaigns của TKQC |
| `/api/facebook/proxy/pause-campaigns` | POST | JWT | Tạm dừng campaigns |
| `/api/facebook/proxy/find-id` | GET | | Tìm Facebook ID |
| `/api/facebook/proxy/ad-library` | GET | | Thư viện quảng cáo |
| `/api/posts` | GET | JWT | Danh sách bài đã lên lịch |
| `/api/posts/schedule` | POST | JWT | Lên lịch bài đăng |
| `/api/posts/:id` | DELETE | JWT | Xóa bài đã lên lịch |
| `/api/ai/generate` | POST | JWT | Tạo nội dung AI |
