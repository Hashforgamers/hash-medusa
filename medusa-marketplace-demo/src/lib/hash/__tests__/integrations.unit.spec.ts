import { validateImage, uploadImage } from "../cloudinary"
import HfgAuthProvider, {verifyHfgToken} from "../../../modules/hfg-auth/service"
import { MedusaError } from "@medusajs/framework/utils"
const png = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII="
describe("Cloudinary uploads",()=>{
 beforeEach(()=>{process.env.CLOUDINARY_CLOUD_NAME="test-cloud";process.env.CLOUDINARY_API_KEY="key";process.env.CLOUDINARY_API_SECRET="secret"})
 test("rejects URLs, SVG, forged MIME types and oversized images",()=>{
  for(const image of ["https://example.com/a.png","data:image/svg+xml;base64,PHN2Zz4=","data:image/png;base64,aGVsbG8=","x".repeat(7_000_001)])expect(()=>validateImage(image)).toThrow()
 })
 test("signed upload scopes public ID to vendor and returns only image metadata",async()=>{
  const fake=jest.fn(async(url,options)=>{
   expect(url).toBe('https://api.cloudinary.com/v1_1/test-cloud/image/upload')
   expect(options.body.get('public_id')).toMatch(/^hash-marketplace\/hv_test\//)
   expect(options.body.get('signature')).toMatch(/^[a-f0-9]{64}$/)
   expect(options.body.get('api_secret')).toBeNull()
   return {ok:true,json:async()=>({secure_url:'https://res.cloudinary.com/test-cloud/image/upload/v1/test.png',public_id:options.body.get('public_id'),format:'png',width:1,height:1})}
  })
  expect((await uploadImage(png,'hv_test',fake as any)).url).toContain('res.cloudinary.com')
 })
 test("never forwards upstream errors or credentials to client",async()=>{
  await expect(uploadImage(png,'hv_test',async()=>({ok:false}) as any)).rejects.toThrow('Image upload failed')
 })
})
describe("HFG identity bridge",()=>{
 beforeEach(()=>{process.env.HFG_USER_ONBOARD_URL='https://hfg-user-onboard.onrender.com'})
 const token='a-valid-existing-hfg-token'
 test("resolves identity only from authenticated upstream profile",async()=>{
  const fake=jest.fn(async(url,options)=>{
   expect(url).toBe('https://hfg-user-onboard.onrender.com/api/users')
   expect(options.headers.Authorization).toBe('Bearer '+token)
   return {ok:true,json:async()=>({user:{id:123,fid:'verified-fid'}})}
  })
  expect(await verifyHfgToken(token,fake as any)).toEqual({id:'123'})
 })
 test("rejects expired, deleted and malformed identities",async()=>{
  for(const response of [{ok:false},{ok:true,json:async()=>({user:{id:1,fid:'x',deleted_at:'now'}})},{ok:true,json:async()=>({user:{id:'arbitrary'}})}])await expect(verifyHfgToken(token,async()=>response as any)).rejects.toThrow()
 })
 test("fails closed without configured HTTPS identity service",async()=>{
  process.env.HFG_USER_ONBOARD_URL='http://untrusted.example';const fake=jest.fn()
  await expect(verifyHfgToken(token,fake)).rejects.toThrow();expect(fake).not.toHaveBeenCalled()
 })
 test("same verified HFG ID reuses identity regardless of client claims",async()=>{
  const original=global.fetch;global.fetch=jest.fn(async()=>({ok:true,json:async()=>({user:{id:123,fid:'fid'}})})) as any
  try {
   const provider=new HfgAuthProvider(), identity={id:'auth_1'}, ids={retrieve:jest.fn(async()=>identity),create:jest.fn()}
   const result=await provider.authenticate({body:{token,id:999,email:'other@example.com'}} as any,ids as any)
   expect(result).toEqual({success:true,authIdentity:identity});expect(ids.retrieve).toHaveBeenCalledWith({entity_id:'hfg:123'});expect(ids.create).not.toHaveBeenCalled()
  }finally{global.fetch=original}
 })
 test("first sign-in creates identity without storing HFG token",async()=>{
  const original=global.fetch;global.fetch=jest.fn(async()=>({ok:true,json:async()=>({user:{id:123,fid:'fid'}})})) as any
  try {
   const provider=new HfgAuthProvider(), ids={retrieve:jest.fn().mockRejectedValue(new MedusaError(MedusaError.Types.NOT_FOUND,'missing')),create:jest.fn(async()=>({id:'auth_new'}))}
   expect((await provider.authenticate({body:{token}} as any,ids as any)).success).toBe(true)
   expect(ids.create).toHaveBeenCalledWith({entity_id:'hfg:123',user_metadata:{hfg_user_id:'123'}})
  }finally{global.fetch=original}
 })
})
