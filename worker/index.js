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
const loginAttempts = new Map()

const LOGIN_LIMITS = {
  WARNING_DELAY: 5 * 1000,
  TEMP_BLOCK: 60 * 1000,
  LONG_BLOCK: 5 * 60 * 1000
}

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

  const ip = c.req.header('CF-Connecting-IP') || 'unknown'
  const now = Date.now()

  let state = loginAttempts.get(ip)

  if (!state) {
    state = {
      failures: 0,
      blockedUntil: 0,
      blockLevel: 0
    }
    loginAttempts.set(ip, state)
  }

  // Đang bị giới hạn
  if (state.blockedUntil > now) {
    const retryAfter = Math.ceil(
      (state.blockedUntil - now) / 1000
    )

    return c.json({
      error: 'Too Many Requests',
      retryAfter
    }, 429, {
      'Retry-After': String(retryAfter)
    })
  }

  try {
    const body = await c.req.json()

    if (!body || typeof body.password !== 'string') {
      return c.json({
        error: 'Invalid Request'
      }, 400)
    }

    const trimmedPassword = body.password.trim()

    // GIỮ NGUYÊN MẬT KHẨU HIỆN TẠI CỦA MÀY Ở DÒNG NÀY
    if (trimmedPassword === 'happy106725') {
      // Đăng nhập đúng → reset giới hạn
      loginAttempts.delete(ip)

      return c.json({
        success: true,
        token: AUTH_TOKEN
      })
    }

    // Sai mật khẩu
    state.failures++

    // 6–9 lần sai → bắt buộc chờ 5 giây
    if (state.failures >= 6 && state.failures < 10) {
      state.blockedUntil = now + LOGIN_LIMITS.WARNING_DELAY
    }

    // Lần sai thứ 10 → khóa 1 phút
    if (state.failures === 10) {
      state.blockLevel = 1
      state.blockedUntil = now + LOGIN_LIMITS.TEMP_BLOCK
    }

    // Sau khi đã từng bị khóa mà tiếp tục dò → 5 phút
    if (state.failures > 10) {
      state.blockLevel = 2
      state.blockedUntil = now + LOGIN_LIMITS.LONG_BLOCK
    }

    loginAttempts.set(ip, state)

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
