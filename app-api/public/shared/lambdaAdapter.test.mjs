import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import {
  ALB_IDENTITY_HEADER,
  createLambdaContext,
  createLambdaEvent,
  installErrorHandlers,
  lazyHandler,
  registerHandlerRoute,
  sendLambdaResponse,
} from './lambdaAdapter.mjs'

function request(overrides = {}) {
  const headers = overrides.headers ?? {}
  return {
    method: 'POST',
    path: '/appuser/profile',
    query: { include: 'settings' },
    headers,
    body: Buffer.from('{"name":"Ada"}'),
    get(name) {
      return headers[name.toLowerCase()]
    },
    ...overrides,
  }
}

test('builds a Lambda-compatible event from an HTTP request', () => {
  const event = createLambdaEvent(request({
    headers: {
      [ALB_IDENTITY_HEADER]: 'user-123',
      'stripe-signature': 'sig',
      'content-type': 'application/json',
    },
  }), { requiresAuth: true })

  assert.equal(event.httpMethod, 'POST')
  assert.equal(event.path, '/appuser/profile')
  assert.deepEqual(event.queryStringParameters, { include: 'settings' })
  assert.equal(event.body, '{"name":"Ada"}')
  assert.equal(event.headers['Stripe-Signature'], 'sig')
  assert.deepEqual(event.requestContext.authorizer.claims, { sub: 'user-123' })
  assert.equal(createLambdaContext(event).awsRequestId, event.requestContext.requestId)
})

test('rejects authenticated requests without the ALB identity header', () => {
  assert.throws(
    () => createLambdaEvent(request(), { requiresAuth: true }),
    { statusCode: 401 },
  )
})

test('does not trust an Authorization header as the identity claim', () => {
  const event = createLambdaEvent(request({
    headers: { authorization: 'Bearer unverified-token' },
  }), { requiresAuth: false })

  assert.equal(event.requestContext.authorizer, undefined)
})

test('sends Lambda response status, headers, and body to the HTTP response', () => {
  let statusCode
  let responseBody
  const responseHeaders = {}
  const res = {
    set(headers) {
      Object.assign(responseHeaders, headers)
      return this
    },
    status(code) {
      statusCode = code
      return this
    },
    send(body) {
      responseBody = body
      return this
    },
  }

  sendLambdaResponse(res, {
    statusCode: '302',
    headers: { Location: '/done' },
    body: '',
  })

  assert.equal(statusCode, 302)
  assert.equal(responseHeaders.Location, '/done')
  assert.equal(responseBody, '')
})

test('loads a handler only when its route is invoked', async () => {
  let loadCount = 0
  const handler = lazyHandler(async () => {
    loadCount += 1
    return { handler: async (event) => event.path }
  })

  assert.equal(loadCount, 0)
  assert.equal(await handler({ path: '/health' }), '/health')
  assert.equal(loadCount, 1)
})

test('forwards a Lambda context with the request id to handlers', async () => {
  let routeHandler
  let responseStatus
  let responseBody
  let receivedContext
  const app = {
    options() {},
    get(_path, handler) {
      routeHandler = handler
    },
  }
  registerHandlerRoute(app, {
    path: '/hook',
    methods: ['GET'],
    handler: async (_event, context) => {
      receivedContext = context
      return { statusCode: 200, body: 'ok' }
    },
  })

  await routeHandler(request({
    method: 'GET',
    path: '/hook',
    query: {},
    body: null,
    headers: {},
  }), {
    status(code) {
      responseStatus = code
      return this
    },
    send(body) {
      responseBody = body
      return this
    },
  })

  assert.equal(responseStatus, 200)
  assert.equal(responseBody, 'ok')
  assert.ok(receivedContext.awsRequestId)
})
