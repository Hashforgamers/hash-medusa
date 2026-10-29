import { readFileSync } from 'fs'
import { join } from 'path'
import { createContext,runInContext } from 'vm'
const script=readFileSync(join(__dirname,'../portal.html'),'utf8').split('<script>')[1].split('async function refresh()')[0]
function response(status:number,value:any){return {status,ok:status>=200&&status<300,text:async()=>JSON.stringify(value),json:async()=>value}}
function context(fetch:any,initial='old'){
 const values=new Map([['hash_token',initial]])
 const ctx=createContext({window:{},sessionStorage:{getItem:k=>values.get(k),setItem:(k,v)=>values.set(k,v)},fetch,AbortSignal,Date,Intl,atob:s=>Buffer.from(s,'base64').toString('utf8')})
 runInContext(script,ctx)
 runInContext("data={actor:{email:'vendor@example.test'}}; var signIns=0; signInAgain=async()=>{signIns++;rememberToken('new-token')}",ctx)
 return {ctx,values,api:(method='POST')=>runInContext(`api('/admin/hash/promotions','${method}',${method==='POST'?"{action:'create'}":'undefined'})`,ctx)}
}
describe('portal session recovery',()=>{
 test('401 preserves the caller form by rejecting after sign-in and does not replay a write',async()=>{
  const fetch=jest.fn().mockResolvedValue(response(401,{message:'Unauthorized'})),t=context(fetch)
  await expect(t.api()).rejects.toThrow('press Save again')
  expect(fetch).toHaveBeenCalledTimes(1);expect(t.values.get('hash_token')).toBe('new-token');expect(runInContext('signIns',t.ctx)).toBe(1)
 })
 test('safe reads retry once after successful sign-in',async()=>{
  const fetch=jest.fn().mockResolvedValueOnce(response(401,{})).mockResolvedValueOnce(response(200,{promotions:[]})),t=context(fetch)
  expect(await t.api('GET')).toEqual({promotions:[]});expect(fetch).toHaveBeenCalledTimes(2);expect(fetch.mock.calls[1][1].headers.Authorization).toBe('Bearer new-token')
 })
 test('a second 401 does not open an endless sign-in loop',async()=>{
  const fetch=jest.fn().mockResolvedValue(response(401,{})),t=context(fetch)
  await expect(t.api('GET')).rejects.toThrow('session expired');expect(fetch).toHaveBeenCalledTimes(2);expect(runInContext('signIns',t.ctx)).toBe(1)
 })
 test('permission errors never trigger sign-in or retries',async()=>{
  const fetch=jest.fn().mockResolvedValue(response(403,{message:'Forbidden'})),t=context(fetch)
  await expect(t.api()).rejects.toThrow('Forbidden');expect(runInContext('signIns',t.ctx)).toBe(0);expect(fetch).toHaveBeenCalledTimes(1)
 })
 test('still-valid tokens near expiration are renewed before a write',async()=>{
  const jwt='x.'+Buffer.from(JSON.stringify({exp:Math.floor(Date.now()/1000)+120})).toString('base64url')+'.x'
  const fetch=jest.fn().mockResolvedValueOnce(response(200,{token:'fresh'})).mockResolvedValueOnce(response(200,{result:{id:'promo'}})),t=context(fetch,jwt)
  await t.api();expect(fetch.mock.calls[0][0]).toBe('/auth/token/refresh');expect(fetch.mock.calls[1][1].headers.Authorization).toBe('Bearer fresh');expect(runInContext('signIns',t.ctx)).toBe(0)
 })
 test('expired credentials are not sent to the refresh endpoint',async()=>{
  const jwt='x.'+Buffer.from(JSON.stringify({exp:1})).toString('base64url')+'.x'
  const fetch=jest.fn().mockResolvedValue(response(401,{})),t=context(fetch,jwt)
  await expect(t.api()).rejects.toThrow('press Save again');expect(fetch.mock.calls[0][0]).toBe('/admin/hash/promotions')
 })
})
