# GenZTech Backend — Facebook Token Manager

Backend server Node.js/Express để quản lý Facebook Token tự động cho hệ thống tự động đăng bài GenZTech.

## Tính năng

- **Quản lý token bảo mật**: App Secret không bao giờ lộ ra frontend
- **Auto-refresh token**: Tự động gia hạn token sắp hết hạn (chạy 3h sáng mỗi ngày)
- **Page Token vĩnh viễn**: Đổi User Token → Page Token không hết hạn
- **Scheduler**: Tự động đăng bài theo lịch (mỗi phút kiểm tra 1 lần)
- **Retry logic**: Thử lại tối đa 3 lần nếu đăng thất bại
- **Repeat posts**: Lặp lại bài đăng theo ngày/tuần/tháng
- **AI Content**: Tạo nội dung qua OpenAI (key bảo mật trên server)
- **Rate limiting**: Chống spam và brute force
- **JWT Auth**: Mỗi user có tài khoản riêng, dữ liệu độc lập

## Cài đặt

```bash
cd backend
npm install
cp .env.example .env
# Điền thông tin vào .env
node server.js
```

## Cấu hình .env

```env
PORT=3001
JWT_SECRET=your_random_secret_min_32_chars
FB_APP_ID=your_facebook_app_id
FB_APP_SECRET=your_facebook_app_secret
OPENAI_API_KEY=your_openai_key
FRONTEND_URL=https://toilahung1.github.io
DB_PATH=./data/genztech.db
```

## Lấy Facebook App ID & Secret

1. Vào [developers.facebook.com](https://developers.facebook.com)
2. Tạo App mới → chọn **Business**
3. Vào **Settings → Basic** → copy **App ID** và **App Secret**
4. Thêm product **Facebook Login** → cấu hình OAuth redirect

## API Endpoints

### Auth
| Method | Path | Mô tả |
|--------|------|-------|
| POST | `/api/auth/register` | Đăng ký tài khoản |
| POST | `/api/auth/login` | Đăng nhập |

### Facebook
| Method | Path | Mô tả |
|--------|------|-------|
| POST | `/api/facebook/connect` | Kết nối (đổi short→long token) |
| GET | `/api/facebook/status` | Kiểm tra trạng thái kết nối |
| POST | `/api/facebook/refresh` | Gia hạn token thủ công |
| GET | `/api/facebook/pages` | Danh sách Pages |
| POST | `/api/facebook/post` | Đăng bài ngay |
| DELETE | `/api/facebook/disconnect` | Ngắt kết nối |

### Posts
| Method | Path | Mô tả |
|--------|------|-------|
| POST | `/api/posts/schedule` | Lên lịch đăng bài |
| GET | `/api/posts/scheduled` | Danh sách bài đã lên lịch |
| DELETE | `/api/posts/scheduled/:id` | Hủy lịch |
| GET | `/api/posts/history` | Lịch sử đăng bài |
| GET | `/api/posts/stats` | Thống kê |

### AI
| Method | Path | Mô tả |
|--------|------|-------|
| POST | `/api/ai/generate` | Tạo 3 phiên bản nội dung |
| POST | `/api/ai/hashtags` | Gợi ý hashtag |

## Deploy lên VPS (Ubuntu)

```bash
# 1. Cài Node.js 20
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs

# 2. Cài PM2
sudo npm install -g pm2

# 3. Clone repo và cài dependencies
git clone https://github.com/toilahung1/genztech.git
cd genztech/backend
npm install
cp .env.example .env
nano .env  # Điền thông tin thực

# 4. Chạy với PM2
pm2 start server.js --name genztech-api
pm2 save
pm2 startup  # Tự khởi động khi reboot

# 5. Cấu hình Nginx reverse proxy
sudo nano /etc/nginx/sites-available/genztech
```

**Nginx config:**
```nginx
server {
    listen 80;
    server_name api.yourdomain.com;

    location / {
        proxy_pass http://localhost:3001;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
    }
}
```

```bash
sudo ln -s /etc/nginx/sites-available/genztech /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx

# 6. Cài SSL với Certbot
sudo certbot --nginx -d api.yourdomain.com
```

## Deploy lên Railway (Miễn phí)

1. Vào [railway.app](https://railway.app) → New Project → Deploy from GitHub
2. Chọn repo `toilahung1/genztech` → chọn thư mục `backend`
3. Thêm biến môi trường trong Settings → Variables
4. Railway tự động build và deploy

## Cập nhật frontend

Sau khi deploy, cập nhật `API_BASE` trong `auto-post.html`:

```javascript
// Thay dòng này trong auto-post.html
const API_BASE = localStorage.getItem('gz_api_base') || 'https://your-api-domain.com';
```

Hoặc user tự set trong console trình duyệt:
```javascript
localStorage.setItem('gz_api_base', 'https://your-api-domain.com')
```
