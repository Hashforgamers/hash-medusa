import { GET } from '../../../api/admin/hash/integration/route'
import { actor } from '../access'
import { Modules } from '@medusajs/framework/utils'
jest.mock('../access',()=>({...jest.requireActual('../access'),actor:jest.fn()}))

describe('storefront integration configuration',()=>{
 test('rejects vendors before reading keys',async()=>{
  ;(actor as jest.Mock).mockResolvedValue({superAdmin:false})
  const resolve=jest.fn()
  await expect(GET({scope:{resolve}} as any,{} as any)).rejects.toThrow('Only Hash administrators')
  expect(resolve).not.toHaveBeenCalled()
 })
 test('returns only active public keys and India INR region fields',async()=>{
  ;(actor as jest.Mock).mockResolvedValue({superAdmin:true})
  const graph=jest.fn().mockResolvedValue({data:[
   {id:'pk1',title:'HFG Frontend',type:'publishable',token:'pk_test',sales_channels:[{id:'sc1',name:'Hash',metadata:{private:true}}]},
   {id:'revoked',type:'publishable',token:'pk_revoked',revoked_at:new Date()},
   {id:'secret',type:'secret',token:'sk_secret'},
  ]})
  const regions=jest.fn().mockResolvedValue([{id:'reg1',name:'India',currency_code:'inr',countries:[{iso_2:'in'}],metadata:{private:true}},{id:'reg2',countries:[{iso_2:'us'}]}])
  const json=jest.fn(),setHeader=jest.fn()
  await GET({scope:{resolve:(key)=>key===Modules.REGION?{listRegions:regions}:{graph}}} as any,{json,setHeader} as any)
  expect(graph.mock.calls[0][0].filters).toEqual({type:'publishable',title:'HFG Frontend'})
  expect(setHeader).toHaveBeenCalledWith('Cache-Control','no-store')
  expect(json).toHaveBeenCalledWith({publishable_keys:[{id:'pk1',title:'HFG Frontend',token:'pk_test',sales_channels:[{id:'sc1',name:'Hash'}]}],regions:[{id:'reg1',name:'India',currency_code:'inr'}]})
 })
})
