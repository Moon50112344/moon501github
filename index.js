import { Hono } from 'hono'
import { serveStatic } from 'hono/cloudflare-workers'
import { cors } from 'hono/cors' // ĐÃ THÊM: Nhập thư viện xử lý CORS

const app = new Hono()

// ĐÃ THÊM: Cấu hình CORS toàn cục cho các cổng dữ liệu /api/
// Giúp trang Admin từ mọi nơi có thể kết nối thành công và không bị trình duyệt chặn dữ liệu
app.use('/api/*', cors({
  origin: '*', 
  allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowHeaders: ['Content-Type', 'Authorization']
}))

// Mảng lưu trữ dữ liệu repositories trong bộ nhớ (In-memory storage)
let repositories = [
  {
    id: '1',
    name: 'GitShowcase',
    description: 'A modern repository gallery built with Hono and Vanilla JS.',
    imageUrl: 'https://unsplash.com',
    repoUrl: 'https://github.com'
  },
  {
    id: '2',
    name: 'Cloudflare Workers Boilerplate',
    description: 'High-performance edge computing template for quick deployment.',
    imageUrl: 'https://unsplash.com',
    repoUrl: 'https://github.com'
  }
];

const AUTH_TOKEN = 'authenticated_session_v1';

// Middleware xác thực quyền Admin (Chỉ áp dụng cho các cổng API Thay đổi dữ liệu như POST/DELETE)
const adminAuth = async (c, next) => {
  const authHeader = c.req.header('Authorization');
  if (authHeader !== `Bearer ${AUTH_TOKEN}`) {
    const ip = c.req.header('CF-Connecting-IP') || 'Unknown IP';
    console.warn(`[Security] Unauthorized access attempt blocked from ${ip} to ${c.req.path}`);
    return c.json({ error: 'Unauthorized' }, 401);
  }
  await next();
};

// ========================================================
// PHÂN HỆ 1: CÁC TUYẾN ĐƯỜNG API (Luôn đặt ưu tiên hàng đầu)
// ========================================================

// 1. API Lấy danh sách dự án (Công khai - KHÔNG ĐƯỢC CHÈN adminAuth ĐỂ TRÁNH LỖI TRANG CHỦ)
app.get('/api/repos', (c) => {
  c.header('Cache-Control', 'no-store, max-age=0');
  return c.json(repositories);
});

// 2. API Xử lý Đăng nhập hệ thống quản trị
app.post('/api/login', async (c) => {
  c.header('Cache-Control', 'no-store, max-age=0');
  try {
    const body = await c.req.json();
    if (!body || typeof body.password !== 'string') {
      return c.json({ error: 'Invalid Request' }, 400);
    }
    const trimmedPassword = body.password.trim();
    if (trimmedPassword === 'happy106725') {
      return c.json({ success: true, token: AUTH_TOKEN });
    }
    return c.json({ error: 'Unauthorized' }, 401);
  } catch (err) {
    console.error('Login error:', err);
    return c.json({ error: 'Invalid Request Format' }, 400);
  }
});

// 3. API Thêm mới dự án vào bộ sưu tập (Bắt buộc xác thực quyền Admin)
app.post('/api/repos', adminAuth, async (c) => {
  c.header('Cache-Control', 'no-store, max-age=0');
  try {
    const data = await c.req.json();
    if (!data.name || !data.imageUrl || !data.repoUrl) {
      return c.json({ error: 'Missing required fields' }, 400);
    }
    const newRepo = {
      id: crypto.randomUUID(),
      ...data
    };
    repositories.unshift(newRepo);
    return c.json(newRepo, 201);
  } catch (err) {
    console.error('Post repo error:', err);
    return c.json({ error: 'Invalid JSON' }, 400);
  }
});

// 4. API Gỡ bỏ hoàn toàn dự án (Bắt buộc xác thực quyền Admin)
app.delete('/api/repos/:id', adminAuth, (c) => {
  c.header('Cache-Control', 'no-store, max-age=0');
  const id = c.req.param('id');
  if (!id) return c.json({ error: 'ID Required' }, 400);
  const index = repositories.findIndex(r => r.id === id);
  if (index === -1) return c.json({ error: 'Not found' }, 404);
  repositories.splice(index, 1);
  return c.json({ success: true });
});

// ========================================================
// PHÂN HỆ 2: ĐỊNH TUYẾN ỔN ĐỊNH FILE TĨNH (ĐÃ ĐỔI MỚI)
// ========================================================

// Định tuyến đường dẫn URL sạch cho các trang giao diện chính
app.get('/repo', serveStatic({ path: './public/repo.html' }));
app.get('/login', serveStatic({ path: './public/login.html' }));
app.get('/admin', serveStatic({ path: './public/admin.html' }));

// 🌟 THAY THẾ dòng app.get('/*') cũ bằng đoạn code kiểm tra an toàn này:
app.get('/*', async (c, next) => {
  // Nếu trình duyệt cố tình gọi nhầm link API vào đây, từ chối nạp file tĩnh để tránh lỗi JSON
  if (c.req.path.startsWith('/api/')) {
    return c.json({ error: 'API Route Not Found' }, 404);
  }
  return serveStatic({ root: './public' })(c, next);
});

export default app;
