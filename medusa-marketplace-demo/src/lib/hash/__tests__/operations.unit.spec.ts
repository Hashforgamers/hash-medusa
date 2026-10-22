import { bankSchema, storedBank, publicVendor } from '../vendor-profile'
import { minorUnits, split } from '../policy'
import { settingsCommand } from '../settings'
const bank={account_holder:'Test Beneficiary',bank_name:'Test Bank',account_number:'000012345678',account_number_confirmation:'000012345678',account_type:'current',country_code:'in',currency_code:'inr',ifsc:'TEST0123456'}
describe('partner bank information',()=>{
 test('preserves leading zeroes and never stores confirmation',()=>{
  const value=storedBank(bankSchema.parse(bank));expect(value.account_number).toBe('000012345678');expect(value.account_number_confirmation).toBeUndefined()
 })
 test.each([{account_number_confirmation:'9999'},{ifsc:'wrong'},{country_code:'us',ifsc:'',swift:'',iban:'',routing_number:''}])('rejects incomplete banking information %j',change=>{expect(bankSchema.safeParse({...bank,...change}).success).toBe(false)})
 test('masks the account for owners/admin and removes all banking/contact fields for staff',()=>{
  const v={id:'hv_1',name:'Partner',bank_details:bank,business_details:{phone:'123'},payout_details:'legacy bank notes'}
  for(const a of [{superAdmin:true},{role:'owner'}]){
   const result=publicVendor(v,a);expect(result.bank_details).toBeUndefined();expect(result.bank_summary.account_last4).toBe('5678');expect(JSON.stringify(result)).not.toContain('000012345678')
  }
  expect(publicVendor(v,{role:'staff'})).toEqual({id:'hv_1',name:'Partner'})
 })
 test('allows a legacy partner with no bank without inventing a bank summary',()=>{expect(publicVendor({id:'hv_1'},{superAdmin:true}).bank_summary).toBeNull()})
})
describe('currency-safe settlement calculations',()=>{
 test.each([['inr',12.34,1234],['usd',12.34,1234],['jpy',123,123],['bhd',12.345,12345]])('uses %s minor units', (currency,major,minor)=>{expect(minorUnits(major,currency as string)).toBe(minor)})
 test('splits odd minor units without losing money',()=>{const value=minorUnits(12.345,'bhd');const s=split(value,0);expect(s.payment+s.completion).toBe(value);expect(s.completion-s.payment).toBe(1)})
 test.each([-1,NaN,Infinity,Number.MAX_SAFE_INTEGER])('rejects unsafe amount %s',n=>expect(()=>minorUnits(n,'usd')).toThrow())
})
describe('operations request validation',()=>{
 test('region requires countries and payment providers',()=>{expect(settingsCommand.safeParse({action:'region',name:'USA',currency_code:'usd',countries:[],payment_providers:[]}).success).toBe(false)})
 test('delivery rate cannot be negative',()=>{expect(settingsCommand.safeParse({action:'shipping',region_id:'reg_1',name:'Delivery',amount:-1}).success).toBe(false)})
})
