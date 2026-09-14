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
// CLOUDFLARE RATE LIMITER
// 100 requests / 10 seconds
// Vượt giới hạn -> 403.html
// ========================================================

const getClientIP = (c) => {
  return c.req.header('CF-Connecting-IP') || 'Unknown IP'
}

const rateLimit403 = async (c) => {
  try {
    const response = await serveStatic({
      path: './public/403.html'
    })(c, async () => {})

    if (!response) {
      return c.text('Access Forbidden', 403)
    }

    const headers = new Headers(response.headers)

    headers.set(
      'Content-Type',
      'text/html; charset=UTF-8'
    )

    headers.set(
      'Cache-Control',
      'no-store, max-age=0'
    )

    return new Response(response.body, {
      status: 403,
      headers
    })
  } catch (err) {
    console.error('403 page error:', err)

    return c.text(
      'Access Forbidden',
      403
    )
  }
}

// ========================================================
// GLOBAL RATE LIMIT
// ========================================================

app.use('*', async (c, next) => {
  // Nếu Rate Limiter chưa được binding,
  // không làm hỏng website.
  if (!c.env.RATE_LIMITER) {
    return next()
  }

  const ip = getClientIP(c)

  try {
    const { success } = await c.env.RATE_LIMITER.limit({
      key: ip
    })

    if (!success) {
      console.warn(
        `[Security] Rate limit exceeded from ${ip} on ${c.req.path}`
      )

      c.header(
        'Retry-After',
        '10'
      )

      return rateLimit403(c)
    }

    return next()

  } catch (err) {
    console.error(
      'Cloudflare Rate Limiter error:',
      err
    )

    // Rate Limiter lỗi thì không được
    // làm sập website.
    return next()
  }
})

// ========================================================
// GLOBAL RATE LIMIT / 429
// ========================================================

const isPublicWhileBlocked = (path) => {
  if (path === '/login') return true
  if (path === '/429.html') return true

  // Cho phép các file giao diện tải bình thường
  if (
    path.startsWith('/assets/') ||
    path.endsWith('.css') ||
    path.endsWith('.js') ||
    path.endsWith('.png') ||
    path.endsWith('.jpg') ||
    path.endsWith('.jpeg') ||
    path.endsWith('.webp') ||
    path.endsWith('.svg') ||
    path.endsWith('.ico') ||
    path.endsWith('.woff') ||
    path.endsWith('.woff2')
  ) {
    return true
  }

  return false
}

// Kiểm tra IP đã bị khóa toàn hệ thống chưa
app.use('*', async (c, next) => {
  const path = c.req.path

  if (isPublicWhileBlocked(path)) {
    return next()
  }

  // Không có KV thì không làm hỏng website
  if (!c.env.LOGIN_RATE_LIMIT) {
    return next()
  }

  const ip = getClientIP(c)

  try {
    const key = `ratelimit:${ip}`
    const raw = await c.env.LOGIN_RATE_LIMIT.get(key)

    if (!raw) {
      return next()
    }

    const state = JSON.parse(raw)
    const now = Date.now()

    // Chưa hết thời gian khóa
    if (state.blockedUntil && state.blockedUntil > now) {
      const retryAfter = Math.ceil(
        (state.blockedUntil - now) / 1000
      )

      c.header(
        'Retry-After',
        String(retryAfter)
      )

      c.header(
        'Cache-Control',
        'no-store, max-age=0'
      )

      return c.json({
        error: 'Too Many Requests',
        message: 'Your IP is temporarily blocked.',
        retryAfter
      }, 429)
    }

    // Hết hạn khóa
    // Nếu đây là block cấp 1 và người đó tiếp tục spam,
    // lần khóa tiếp theo sẽ dài hơn.
    if (state.blockedUntil && state.blockedUntil <= now) {
      state.blockedUntil = 0

      await c.env.LOGIN_RATE_LIMIT.put(
        key,
        JSON.stringify(state),
        {
          expirationTtl: 600
        }
      )
    }

    return next()

  } catch (err) {
    console.error(
      'Rate limit check error:',
      err
    )

    // Rate limit lỗi thì không được làm sập website
    return next()
  }
})

// ========================================================
// ADMIN AUTH
// ========================================================

const adminAuth = async (c, next) => {
  const authHeader = c.req.header('Authorization')

  if (authHeader !== `Bearer ${AUTH_TOKEN}`) {
    const ip = getClientIP(c)

    console.warn(
      `[Security] Unauthorized access attempt blocked from ${ip} to ${c.req.path}`
    )

    return c.json({
      error: 'Unauthorized'
    }, 401)
  }

  await next()
}

// ========================================================
// API: GET REPOSITORIES
// ========================================================

app.get('/api/repos', async (c) => {
  c.header(
    'Cache-Control',
    'no-store, max-age=0'
  )

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
    console.error(
      'Get repos error:',
      err
    )

    return c.json({
      error: 'Failed to load repositories'
    }, 500)
  }
})

// ========================================================
// API: LOGIN
// ========================================================

app.post('/api/login', async (c) => {
  c.header(
    'Cache-Control',
    'no-store, max-age=0'
  )

  const ip = getClientIP(c)
  const key = `ratelimit:${ip}`

  try {
    const body = await c.req.json()

    if (
      !body ||
      typeof body.password !== 'string'
    ) {
      return c.json({
        error: 'Invalid Request'
      }, 400)
    }

    const trimmedPassword =
      body.password.trim()

    // ====================================================
    // ĐỌC TRẠNG THÁI RATE LIMIT
    // ====================================================

    let state = {
      failures: 0,
      blockedUntil: 0,
      blockLevel: 0
    }

    if (c.env.LOGIN_RATE_LIMIT) {
      try {
        const raw =
          await c.env.LOGIN_RATE_LIMIT.get(key)

        if (raw) {
          state = {
            ...state,
            ...JSON.parse(raw)
          }
        }
      } catch (err) {
        console.error(
          'Rate limit read error:',
          err
        )
      }
    }

    const now = Date.now()

    // ====================================================
    // VẪN ĐANG BỊ KHÓA
    // ====================================================

    if (
      state.blockedUntil &&
      state.blockedUntil > now
    ) {
      const retryAfter = Math.ceil(
        (state.blockedUntil - now) / 1000
      )

      c.header(
        'Retry-After',
        String(retryAfter)
      )

      return c.json({
        error: 'Too Many Requests',
        message: 'Too many login attempts.',
        retryAfter
      }, 429)
    }

    // ====================================================
    // ĐÃ HẾT BLOCK
    // ====================================================

    if (
      state.blockedUntil &&
      state.blockedUntil <= now
    ) {
      state.blockedUntil = 0
    }

    // ====================================================
    // PASSWORD ĐÚNG
    // ====================================================

    if (
      trimmedPassword === 'happy106725'
    ) {
      // Login đúng -> reset hoàn toàn bộ đếm
      if (c.env.LOGIN_RATE_LIMIT) {
        try {
          await c.env.LOGIN_RATE_LIMIT.delete(
            key
          )
        } catch (err) {
          console.error(
            'Rate limit reset error:',
            err
          )
        }
      }

      return c.json({
        success: true,
        token: AUTH_TOKEN
      })
    }

    // ====================================================
    // PASSWORD SAI
    // ====================================================

    state.failures += 1

    // ====================================================
    // LẦN 1-5
    // ====================================================

    if (state.failures <= 5) {
      if (c.env.LOGIN_RATE_LIMIT) {
        await c.env.LOGIN_RATE_LIMIT.put(
          key,
          JSON.stringify(state),
          {
            expirationTtl: 600
          }
        )
      }

      return c.json({
        error: 'Unauthorized'
      }, 401)
    }

    // ====================================================
    // LẦN 6-9
    // Delay 5 giây
    // ====================================================

    if (
      state.failures >= 6 &&
      state.failures <= 9
    ) {
      await new Promise(
        resolve => setTimeout(resolve, 5000)
      )

      if (c.env.LOGIN_RATE_LIMIT) {
        await c.env.LOGIN_RATE_LIMIT.put(
          key,
          JSON.stringify(state),
          {
            expirationTtl: 600
          }
        )
      }

      return c.json({
        error: 'Unauthorized',
        message: 'Please wait before trying again.'
      }, 401)
    }

    // ====================================================
    // LẦN 10
    // BLOCK 1 PHÚT
    // ====================================================

    if (state.failures === 10) {
      state.blockLevel = 1
      state.blockedUntil =
        now + (60 * 1000)

      if (c.env.LOGIN_RATE_LIMIT) {
        await c.env.LOGIN_RATE_LIMIT.put(
          key,
          JSON.stringify(state),
          {
            expirationTtl: 600
          }
        )
      }

      c.header(
        'Retry-After',
        '60'
      )

      return c.json({
        error: 'Too Many Requests',
        message: 'Too many login attempts.',
        retryAfter: 60
      }, 429)
    }

    // ====================================================
    // SAU KHI BLOCK 1 PHÚT MÀ TIẾP TỤC SPAM
    // BLOCK 5 PHÚT
    // ====================================================

    if (state.failures > 10) {
      state.blockLevel = 2
      state.blockedUntil =
        now + (5 * 60 * 1000)

      if (c.env.LOGIN_RATE_LIMIT) {
        await c.env.LOGIN_RATE_LIMIT.put(
          key,
          JSON.stringify(state),
          {
            expirationTtl: 900
          }
        )
      }

      c.header(
        'Retry-After',
        '300'
      )

      return c.json({
        error: 'Too Many Requests',
        message: 'Your IP has been temporarily blocked.',
        retryAfter: 300
      }, 429)
    }

    return c.json({
      error: 'Unauthorized'
    }, 401)

  } catch (err) {
    console.error(
      'Login error:',
      err
    )

    return c.json({
      error: 'Invalid Request Format'
    }, 400)
  }
})

// ========================================================
// API: ADD REPOSITORY
// ========================================================

app.post(
  '/api/repos',
  adminAuth,
  async (c) => {
    c.header(
      'Cache-Control',
      'no-store, max-age=0'
    )

    try {
      const data =
        await c.req.json()

      if (
        !data.name ||
        !data.imageUrl ||
        !data.repoUrl
      ) {
        return c.json({
          error: 'Missing required fields'
        }, 400)
      }

      const id =
        crypto.randomUUID()

      const name =
        data.name

      const description =
        data.description || ''

      const imageUrl =
        data.imageUrl

      const repoUrl =
        data.repoUrl

      const createdAt =
        Date.now()

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
      console.error(
        'Post repo error:',
        err
      )

      return c.json({
        error: 'Failed to save repository'
      }, 500)
    }
  }
)

// ========================================================
// API: DELETE REPOSITORY
// ========================================================

app.delete(
  '/api/repos/:id',
  adminAuth,
  async (c) => {
    c.header(
      'Cache-Control',
      'no-store, max-age=0'
    )

    const id =
      c.req.param('id')

    if (!id) {
      return c.json({
        error: 'ID Required'
      }, 400)
    }

    try {
      const result =
        await c.env.DB
          .prepare(`
            DELETE FROM repositories
            WHERE id = ?
          `)
          .bind(id)
          .run()

      if (
        !result.meta ||
        !result.meta.changes
      ) {
        return c.json({
          error: 'Not found'
        }, 404)
      }

      return c.json({
        success: true
      })

    } catch (err) {
      console.error(
        'Delete repo error:',
        err
      )

      return c.json({
        error: 'Failed to delete repository'
      }, 500)
    }
  }
)

// ========================================================
// STATIC ROUTES
// ========================================================

app.get(
  '/repo',
  serveStatic({
    path: './public/repo.html'
  })
)

app.get(
  '/login',
  serveStatic({
    path: './public/login.html'
  })
)

// Giữ nguyên /admin
app.get(
  '/admin',
  serveStatic({
    path: './public/admin.html'
  })
)

// ========================================================
// FALLBACK
// ========================================================

app.get(
  '/*',
  async (c, next) => {
    if (
      c.req.path.startsWith('/api/')
    ) {
      return c.json({
        error: 'API Route Not Found'
      }, 404)
    }

    return serveStatic({
      root: './public'
    })(c, next)
  }
)

export default app
