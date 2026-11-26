import HfgCafeAuthProvider, {verifyHfgCafeToken} from "../../../modules/hfg-cafe-auth/service"
import { MedusaError } from "@medusajs/framework/utils"
describe("HFG cafe identity bridge",()=>{
 beforeEach(()=>{process.env.HFG_DASHBOARD_URL='https://hfg-dashboard.example.com'})
 const token='a-valid-existing-dashboard-token'
 const ok=(buyer:any)=>({ok:true,json:async()=>({buyer})})
 test("asks hfg-dashboard which cafe the token belongs to",async()=>{
  const fake=jest.fn(async(url,options)=>{
   expect(url).toBe('https://hfg-dashboard.example.com/api/vendor/7/marketplace/buyer')
   expect(options.headers.Authorization).toBe('Bearer '+token)
   return ok({vendor_id:7,cafe_name:'Pixel Den'})
  })
  expect(await verifyHfgCafeToken(token,'7',fake as any)).toEqual({id:'7',name:'Pixel Den'})
 })
 test("rejects refused sessions, another cafe's answer and bad cafe ids",async()=>{
  await expect(verifyHfgCafeToken(token,7,async()=>({ok:false}) as any)).rejects.toThrow()
  await expect(verifyHfgCafeToken(token,7,async()=>ok({vendor_id:8}) as any)).rejects.toThrow()
  const fake=jest.fn()
  for(const vid of [undefined,0,-1,'7/../8','abc',1.5])await expect(verifyHfgCafeToken(token,vid,fake)).rejects.toThrow()
  expect(fake).not.toHaveBeenCalled()
 })
 test("fails closed without a configured HTTPS dashboard origin",async()=>{
  const fake=jest.fn()
  for(const origin of [undefined,'http://hfg-dashboard.example.com','https://hfg-dashboard.example.com/api']){
   if(origin===undefined)delete process.env.HFG_DASHBOARD_URL;else process.env.HFG_DASHBOARD_URL=origin
   await expect(verifyHfgCafeToken(token,7,fake)).rejects.toThrow()
  }
  expect(fake).not.toHaveBeenCalled()
 })
 test("one store identity per cafe, created on first sign-in",async()=>{
  const original=global.fetch;global.fetch=jest.fn(async()=>ok({vendor_id:7,cafe_name:'Pixel Den'})) as any
  try {
   const provider=new HfgCafeAuthProvider(), ids={retrieve:jest.fn().mockRejectedValue(new MedusaError(MedusaError.Types.NOT_FOUND,'missing')),create:jest.fn(async()=>({id:'auth_new'}))}
   expect((await provider.authenticate({body:{token,vendor_id:7}} as any,ids as any)).success).toBe(true)
   expect(ids.create).toHaveBeenCalledWith({entity_id:'hfg-cafe:7',user_metadata:{hfg_vendor_id:'7',cafe_name:'Pixel Den'}})
   const denied=await new HfgCafeAuthProvider().authenticate({body:{token}} as any,ids as any)
   expect(denied.success).toBe(false)
  }finally{global.fetch=original}
 })
})
