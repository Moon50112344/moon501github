import { Hono } from 'hono'
import { serveStatic } from 'hono/cloudflare-workers'
import { cors } from 'hono/cors'

const app = new Hono()

// ========================================================
// CORS
// ========================================================
app.use('/api/*', cors({
  origin: '*',
  allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowHeaders: ['Content-Type', 'Authorization']
}))

const AUTH_TOKEN = 'authenticated_session_v1'

// ========================================================
// LOGIN RATE LIMIT
// ========================================================
const LOGIN_WARNING_DELAY = 5000
const LOGIN_TEMP_BLOCK = 60000
const LOGIN_LONG_BLOCK = 300000

// ========================================================
// ADMIN AUTH
// ========================================================
const adminAuth = async (c, next) => {
  const authHeader = c.req.header('Authorization')

  if (authHeader !== `Bearer ${AUTH_TOKEN}`) {
    const ip = c.req.header('CF-Connecting-IP') || 'Unknown IP'

    console.warn(
      `[Security] Unauthorized access attempt blocked from ${ip} to ${c.req.path}`
    )

    return c.json({ error: 'Unauthorized' }, 401)
  }

  await next()
}

// ========================================================
// API: GET REPOSITORIES
// ========================================================
app.get('/api/repos', async (c) => {
  c.header('Cache-Control', 'no-store, max-age=0')

  try {
    const { results } = await c.env.DB
      .prepare(`
        SELECT id, name, description, imageUrl, repoUrl
        FROM repositories
        ORDER BY created_at DESC
      `)
      .all()

    return c.json(results || [])

  } catch (err) {
    console.error('Get repos error:', err)

    return c.json({
      error: 'Failed to load repositories'
    }, 500)
  }
})

// ========================================================
// API: LOGIN
// ========================================================
app.post('/api/login', async (c) => {
  c.header('Cache-Control', 'no-store, max-age=0')

  try {
    const ip = c.req.header('CF-Connecting-IP') || 'Unknown IP'
    const key = `login:${ip}`
    const now = Date.now()

    // Lấy trạng thái từ Cloudflare KV
    let state = await c.env.LOGIN_RATE_LIMIT.get(key, 'json')

    if (!state) {
      state = {
        failures: 0,
        blockedUntil: 0
      }
    }

    // ====================================================
    // ĐANG BỊ KHÓA
    // ====================================================
    if (state.blockedUntil > now) {
      const remaining = Math.ceil(
        (state.blockedUntil - now) / 1000
      )

      c.header('Retry-After', String(remaining))

      return c.json({
        error: 'Too Many Requests',
        retryAfter: remaining
      }, 429)
    }

    // ====================================================
    // ĐỌC REQUEST
    // ====================================================
    const body = await c.req.json()

    if (!body || typeof body.password !== 'string') {
      return c.json({
        error: 'Invalid Request'
      }, 400)
    }

    const trimmedPassword = body.password.trim()

    // ====================================================
    // ĐĂNG NHẬP ĐÚNG
    // ====================================================
    if (trimmedPassword === 'happy106725') {
      // Đăng nhập thành công -> xóa rate limit
      await c.env.LOGIN_RATE_LIMIT.delete(key)

      return c.json({
        success: true,
        token: AUTH_TOKEN
      })
    }

    // ====================================================
    // MẬT KHẨU SAI
    // ====================================================
    state.failures++

    // Lần 6-9: bắt chờ 5 giây
    if (
      state.failures >= 6 &&
      state.failures < 10
    ) {
      state.blockedUntil = now + LOGIN_WARNING_DELAY
    }

    // Lần 10: khóa 1 phút
    if (state.failures === 10) {
      state.blockedUntil = now + LOGIN_TEMP_BLOCK
    }

    // Sau lần 10: khóa 5 phút
    if (state.failures > 10) {
      state.blockedUntil = now + LOGIN_LONG_BLOCK
    }

    // Lưu trạng thái vào KV
    await c.env.LOGIN_RATE_LIMIT.put(
      key,
      JSON.stringify(state),
      {
        expirationTtl: 3600
      }
    )

    // ====================================================
    // TỪ LẦN 10 TRỞ ĐI -> 429
    // ====================================================
    if (state.failures >= 10) {
      const remaining = Math.ceil(
        (state.blockedUntil - now) / 1000
      )

      c.header('Retry-After', String(remaining))

      return c.json({
        error: 'Too Many Requests',
        retryAfter: remaining
      }, 429)
    }

    // ====================================================
    // LOGIN SAI BÌNH THƯỜNG
    // ====================================================
    return c.json({
      error: 'Unauthorized'
    }, 401)

  } catch (err) {
    console.error('Login error:', err)

    return c.json({
      error: 'Invalid Request Format'
    }, 400)
  }
})

// ========================================================
// API: ADD REPOSITORY
// ========================================================
app.post('/api/repos', adminAuth, async (c) => {
  c.header('Cache-Control', 'no-store, max-age=0')

  try {
    const data = await c.req.json()

    if (!data.name || !data.imageUrl || !data.repoUrl) {
      return c.json({
        error: 'Missing required fields'
      }, 400)
    }

    const id = crypto.randomUUID()
    const name = data.name
    const description = data.description || ''
    const imageUrl = data.imageUrl
    const repoUrl = data.repoUrl
    const createdAt = Date.now()

    await c.env.DB
      .prepare(`
        INSERT INTO repositories
        (id, name, description, imageUrl, repoUrl, created_at)
        VALUES (?, ?, ?, ?, ?, ?)
      `)
      .bind(
        id,
        name,
        description,
        imageUrl,
        repoUrl,
        createdAt
      )
      .run()

    return c.json({
      id,
      name,
      description,
      imageUrl,
      repoUrl
    }, 201)

  } catch (err) {
    console.error('Post repo error:', err)

    return c.json({
      error: 'Failed to save repository'
    }, 500)
  }
})

// ========================================================
// API: DELETE REPOSITORY
// ========================================================
app.delete('/api/repos/:id', adminAuth, async (c) => {
  c.header('Cache-Control', 'no-store, max-age=0')

  const id = c.req.param('id')

  if (!id) {
    return c.json({
      error: 'ID Required'
    }, 400)
  }

  try {
    const result = await c.env.DB
      .prepare(`
        DELETE FROM repositories
        WHERE id = ?
      `)
      .bind(id)
      .run()

    if (!result.meta || !result.meta.changes) {
      return c.json({
        error: 'Not found'
      }, 404)
    }

    return c.json({
      success: true
    })

  } catch (err) {
    console.error('Delete repo error:', err)

    return c.json({
      error: 'Failed to delete repository'
    }, 500)
  }
})

// ========================================================
// STATIC ROUTES
// ========================================================
app.get('/repo', serveStatic({
  path: './public/repo.html'
}))

app.get('/login', serveStatic({
  path: './public/login.html'
}))

// Giữ nguyên /admin
app.get('/admin', serveStatic({
  path: './public/admin.html'
}))

// ========================================================
// FALLBACK
// ========================================================
app.get('/*', async (c, next) => {
  if (c.req.path.startsWith('/api/')) {
    return c.json({
      error: 'API Route Not Found'
    }, 404)
  }

  return serveStatic({
    root: './public'
  })(c, next)
})

export default app
