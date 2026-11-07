import { randomUUID } from 'node:crypto'

export const ALB_IDENTITY_HEADER = 'x-amzn-oidc-identity'

export function lazyHandler(loadHandler) {
  return async (event) => {
    const module = await loadHandler()
    return module.handler(event)
  }
}

export function createLambdaEvent(req, { requiresAuth = false } = {}) {
  const sub = req.get(ALB_IDENTITY_HEADER)
  if (requiresAuth && !sub) {
    const error = new Error('Authenticated identity is missing')
    error.statusCode = 401
    throw error
  }

  const headers = { ...req.headers }
  for (const [name, value] of Object.entries(req.headers)) {
    const canonicalName = name
      .split('-')
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
      .join('-')
    headers[canonicalName] = value
  }
  if (headers.Soapaction !== undefined) {
    headers.SOAPAction = headers.Soapaction
  }

  const queryStringParameters = Object.keys(req.query ?? {}).length
    ? req.query
    : null
  const body = Buffer.isBuffer(req.body)
    ? req.body.toString('utf8')
    : req.body ?? null

  return {
    httpMethod: req.method,
    path: req.path,
    queryStringParameters,
    headers,
    body,
    isBase64Encoded: false,
    requestContext: {
      requestId: req.get('x-amzn-trace-id') ?? randomUUID(),
      ...(requiresAuth ? { authorizer: { claims: { sub } } } : {}),
    },
  }
}

export function createLambdaContext(event) {
  return { awsRequestId: event.requestContext.requestId }
}

export function sendLambdaResponse(res, result) {
  if (!result || !Number.isInteger(Number(result.statusCode))) {
    throw new TypeError('Handler returned an invalid response')
  }

  const statusCode = Number(result.statusCode)
  if (statusCode < 100 || statusCode > 599) {
    throw new TypeError(`Handler returned invalid status code: ${statusCode}`)
  }

  const headers = { ...(result.headers ?? {}) }
  for (const [name, values] of Object.entries(result.multiValueHeaders ?? {})) {
    headers[name] = values
  }
  if (Object.keys(headers).length > 0) {
    res.set(headers)
  }

  let body = result.body ?? ''
  if (result.isBase64Encoded) {
    body = Buffer.from(String(body), 'base64')
  } else if (typeof body === 'object' && !Buffer.isBuffer(body)) {
    body = JSON.stringify(body)
    if (!headers['Content-Type'] && !headers['content-type']) {
      res.type('application/json')
    }
  }

  return res.status(statusCode).send(body)
}

export function registerHandlerRoute(app, {
  path,
  methods,
  handler,
  requiresAuth = false,
}) {
  app.options(path, (_req, res) => {
    res
      .set('Access-Control-Allow-Origin', '*')
      .set('Access-Control-Allow-Methods', [...methods, 'OPTIONS'].join(', '))
      .set('Access-Control-Allow-Headers', 'Authorization, Content-Type, Stripe-Signature')
      .status(204)
      .end()
  })

  for (const method of methods) {
    const register = app[method.toLowerCase()]
    if (typeof register !== 'function') {
      throw new TypeError(`Unsupported HTTP method: ${method}`)
    }

    register.call(app, path, async (req, res) => {
      const event = createLambdaEvent(req, { requiresAuth })
      const result = await handler(event, createLambdaContext(event))
      return sendLambdaResponse(res, result)
    })
  }
}

export function installHealthCheck(app) {
  app.get('/health', (_req, res) => {
    res.status(200).json({ status: 'ok' })
  })
}

export function installErrorHandlers(app) {
  app.use((req, res) => {
    res.status(404).json({ error: 'Not Found' })
  })

  app.use((error, req, res, next) => {
    if (res.headersSent) {
      return next(error)
    }

    const requestedStatus = Number(error.statusCode ?? error.status)
    const statusCode = requestedStatus >= 400 && requestedStatus <= 599
      ? requestedStatus
      : 500
    console.error('HTTP request failed', {
      method: req.method,
      path: req.path,
      message: error.message,
    })
    return res.status(statusCode).json({
      error: statusCode < 500 ? error.message : 'Internal Server Error',
    })
  })
}
