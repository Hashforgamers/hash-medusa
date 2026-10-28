import {validatePickupDate} from '../dispatch'
import {dispatchAddress} from '../shipping-address'
describe('simple dispatch validation',()=>{
 test('pickup dates use the India 2pm slot, with notice and a bounded scheduling window',()=>{
  const now=Date.parse('2026-10-28T07:00:00Z')
  expect(()=>validatePickupDate('2026-10-28',now)).not.toThrow()
  for(const d of ['2026-02-30','2026-10-27','2027-01-01','invalid'])expect(()=>validatePickupDate(d,now)).toThrow()
  expect(()=>validatePickupDate('2026-10-28',Date.parse('2026-10-28T08:00:00Z'))).toThrow()
 })
 test('both shipment addresses need complete Indian contact and postal details',()=>{
  const a={first_name:'Sample',address_1:'Example address',city:'Mumbai',province:'Maharashtra',postal_code:'401107',phone:'9000000000'}
  expect(dispatchAddress.parse(a).country_code).toBe('in')
  for(const patch of [{phone:''},{postal_code:'0'},{country_code:'us'},{address_1:''}])expect(dispatchAddress.safeParse({...a,...patch}).success).toBe(false)
 })
})
