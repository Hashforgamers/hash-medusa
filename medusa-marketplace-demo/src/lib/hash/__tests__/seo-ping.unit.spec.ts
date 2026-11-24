import { pingProducts } from '../seo-ping'

describe('website SEO ping',()=>{
 const env={...process.env}
 let fetchMock:jest.Mock
 const logger={warn:jest.fn()}
 beforeEach(()=>{fetchMock=jest.fn().mockResolvedValue({ok:true,status:200});(global as any).fetch=fetchMock;logger.warn.mockReset();process.env={...env};delete process.env.SEO_PING_URL})
 afterAll(()=>{process.env=env})

 test('does nothing without a secret',async()=>{
  delete process.env.SEO_PING_SECRET
  await pingProducts(['prod_1'],logger)
  expect(fetchMock).not.toHaveBeenCalled()
 })
 test('never sends an empty list',async()=>{
  process.env.SEO_PING_SECRET='s3cret'
  await pingProducts([],logger)
  await pingProducts(['',undefined as any],logger)
  expect(fetchMock).not.toHaveBeenCalled()
 })
 test('posts product IDs with the bearer secret to the default URL',async()=>{
  process.env.SEO_PING_SECRET='s3cret'
  await pingProducts(['prod_1','prod_1','prod_2'],logger)
  expect(fetchMock).toHaveBeenCalledTimes(1)
  const [url,init]=fetchMock.mock.calls[0]
  expect(url).toBe('https://www.hashforgamers.com/api/seo/indexnow')
  expect(init.method).toBe('POST')
  expect(init.headers.Authorization).toBe('Bearer s3cret')
  expect(JSON.parse(init.body)).toEqual({productIds:['prod_1','prod_2']})
  expect(init.signal).toBeDefined()
 })
 test('a fetch rejection does not throw and the secret is not logged',async()=>{
  process.env.SEO_PING_SECRET='s3cret'
  process.env.SEO_PING_URL='https://example.test/ping'
  fetchMock.mockRejectedValue(new Error('network down'))
  await expect(pingProducts(['prod_1'],logger)).resolves.toBeUndefined()
  expect(fetchMock.mock.calls[0][0]).toBe('https://example.test/ping')
  expect(logger.warn).toHaveBeenCalledTimes(1)
  expect(logger.warn.mock.calls[0][0]).not.toContain('s3cret')
 })
 test('a synchronous fetch failure does not throw',async()=>{
  process.env.SEO_PING_SECRET='s3cret'
  fetchMock.mockImplementation(()=>{throw new TypeError('fetch unavailable')})
  expect(()=>pingProducts(['prod_1'],logger)).not.toThrow()
  expect(logger.warn).toHaveBeenCalled()
 })
})
