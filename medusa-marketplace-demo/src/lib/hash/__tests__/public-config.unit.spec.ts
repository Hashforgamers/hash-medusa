import { GET } from '../../../api/hash-store/config/route'
import { Modules } from '@medusajs/framework/utils'

describe('public storefront bootstrap',()=>{
 const key={type:'publishable',title:'HFG Frontend',token:'pk_public',sales_channels:[{id:'sc_hash',name:'Hash Marketplace',is_disabled:false}]}
 const region={id:'reg_india',currency_code:'inr',countries:[{iso_2:'in'}]}
 async function run(keys:any[]=[key],regions:any[]=[region]){
  const res:any={setHeader:jest.fn(),json:jest.fn(),status:jest.fn()};res.status.mockReturnValue(res)
  const graph=jest.fn().mockResolvedValue({data:keys})
  await GET({scope:{resolve:(name)=>name===Modules.REGION?{listRegions:async()=>regions}:{graph}}} as any,res)
  return res
 }
 test('works without authentication and exposes only public configuration',async()=>{
  const res=await run([{...key,private_field:'do not return'}])
  expect(res.json).toHaveBeenCalledWith({version:1,publishable_api_key:'pk_public',region_id:'reg_india',sales_channel_id:'sc_hash',currency_code:'inr',country_code:'in'})
  expect(res.setHeader).toHaveBeenCalledWith('Access-Control-Allow-Origin','*')
  expect(res.setHeader).toHaveBeenCalledWith('Cache-Control','no-store')
 })
 test.each([
  [],[{...key,type:'secret',token:'sk_secret'}],[{...key,revoked_at:new Date()}],
  [{...key,title:'Other app'}],[{...key,sales_channels:[]}],
  [{...key,sales_channels:[{id:'sc_hash',name:'Hash Marketplace',is_disabled:true}]}],
  [key,{...key,token:'pk_second'}],
 ])('fails closed for missing, unsafe or ambiguous keys: %j',async(...entries)=>{
  const res=await run(entries)
  expect(res.status).toHaveBeenCalledWith(503)
  expect(JSON.stringify(res.json.mock.calls)).not.toContain('pk_public')
 })
 test('rejects missing or ambiguous India configuration',async()=>{
  for(const regions of [[],[region,{...region,id:'reg_second'}]]) expect((await run([key],regions)).status).toHaveBeenCalledWith(503)
 })
})
