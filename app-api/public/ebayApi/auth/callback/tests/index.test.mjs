import { handler } from '../src/handlers/index.mjs'

// Mock the AWS SDK and eBay module
jest.mock('/home/jtran/workspace/vendortoolkit/app-backend/aws-lambda/app-api/layers/awsSdk/awsSdk_module/index.mjs', () => {
  const mDocClient = { query: jest.fn(), update: jest.fn() }
  return {
    DynamoDBDocument: { from: () => mDocClient },
    DynamoDB: jest.fn(),
    SSMClient: jest.fn(),
    GetParametersCommand: jest.fn(),
    sharedConfig: {},
  }
})

jest.mock('/home/jtran/workspace/vendortoolkit/app-backend/aws-lambda/app-api/layers/ebayApi/ebayApi_module/index.mjs', () => ({
  getEbayConfig: jest.fn(() => Promise.resolve({ sandbox: {}, production: {} })),
  initEbayAPI: jest.fn(() => ({
    oAuth2: { getToken: jest.fn(() => Promise.resolve({
      access_token: 'abc123',
      expires_in: 3600,
      refresh_token: 'refresh123',
      refresh_token_expires_in: 7200,
    })) }
  })),
}))

describe('Lambda handler', () => {
  it('returns error if no state or code', async () => {
    const event = { queryStringParameters: {} }
    const res = await handler(event)
    expect(res.statusCode).toBe(302)
    const body = JSON.parse(res.body)
    expect(body.error.message).toMatch(/Invalid Auth Credentials/)
  })

  it('successfully stores token with valid state/code', async () => {
    // Mock DynamoDB response for state token
    const { DynamoDBDocument } = await import('/home/jtran/workspace/vendortoolkit/app-backend/aws-lambda/app-api/layers/awsSdk/awsSdk_module/index.mjs')
    const mockDocClient = DynamoDBDocument.from()
    mockDocClient.query.mockResolvedValue({
      Items: [{ user_id: 'user123', state_token_created: new Date().toISOString(), state_token_used: false, ebay_env: 'sandbox' }]
    })
    mockDocClient.update.mockResolvedValue({})

    const event = { queryStringParameters: { state: 'abc', code: '123' } }
    const res = await handler(event)
    expect(res.statusCode).toBe(302)
    expect(res.headers.Location).toMatch(/connect_success/)
  })

  it('returns error if state token expired', async () => {
    const { DynamoDBDocument } = await import('/home/jtran/workspace/vendortoolkit/app-backend/aws-lambda/app-api/layers/awsSdk/awsSdk_module/index.mjs')
    const mockDocClient = DynamoDBDocument.from()
    const oldDate = new Date(Date.now() - 20 * 60 * 1000).toISOString()
    mockDocClient.query.mockResolvedValue({
      Items: [{ user_id: 'user123', state_token_created: oldDate, state_token_used: true, ebay_env: 'sandbox' }]
    })

    const event = { queryStringParameters: { state: 'abc', code: '123' } }
    const res = await handler(event)
    const body = JSON.parse(res.body)
    expect(body.error.message).toMatch(/State token has expired/)
  })
})
