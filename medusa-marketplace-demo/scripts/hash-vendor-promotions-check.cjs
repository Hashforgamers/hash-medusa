// Local HTTP integration only: two independent vendors and carts, no external payments.
require('dotenv').config({quiet:true});const assert=require('node:assert/strict'),fs=require('fs'),crypto=require('crypto');
const db=new (require('pg').Pool)({connectionString:'postgres://marketplace:super-secure-password@127.0.0.1:5433/marketplace'});
const base='http://localhost:9000',suffix=Date.now(),created=[],products=[];let admin,key;
async function req(path,method='GET',body,token=admin,expected=200){const r=await fetch(base+path,{method,headers:{'content-type':'application/json',...(key?{'x-publishable-api-key':key}:{}),...(token?{authorization:'Bearer '+token}:{})},...(body!==undefined?{body:JSON.stringify(body)}:{})});const d=await r.json();assert.equal(r.status,expected,`${method} ${path}: ${JSON.stringify(d)}`);return d}
async function vendor(label){const v=(await req('/admin/hash','POST',{action:'onboard',name:'Promo QA '+label+' '+suffix,email:`promo-vendor-${label}-${suffix}@example.test`})).result;
 const token=(await req('/auth/user/emailpass','POST',{email:v.email,password:v.temporary_password},null)).token;
 const password=crypto.randomBytes(20).toString('base64url');await req('/admin/hash','POST',{action:'change_password',current_password:v.temporary_password,new_password:password},token);return {...v,token,password}}
async function product(v){const p=(await req('/admin/hash','POST',{action:'save_product',vendor_id:v.vendor_id,title:'Vendor promo test '+suffix,kind:'service',price_inr:100,stock:10},v.token)).result;products.push(p.product_id);await req('/admin/hash','POST',{action:'review_product',product_id:p.product_id,approval:'approved'});return (await req('/admin/hash','GET',undefined,v.token)).products.find(x=>x.product_id===p.product_id)}
const definition=extra=>({code:'VP'+suffix+'_'+created.length,discount_type:'percentage',value:10,currency_code:'inr',...extra});
async function create(token,extra={}){const p=(await req('/admin/hash/promotions','POST',{action:'create',definition:definition(extra)},token)).result;created.push(p.id);return p}
const state=(p,status,token=admin,expected=200)=>req('/admin/hash/promotions','POST',{action:'state',id:p.id,status,updated_at:p.updated_at},token,expected);
(async()=>{try{
 const {rows:[u]}=await db.query(`SELECT id FROM "user" WHERE metadata->>'is_super_admin'='true' AND deleted_at IS NULL LIMIT 1`);
 admin=require('jsonwebtoken').sign({actor_id:u.id,actor_type:'user',auth_identity_id:'local-vendor-promo'},process.env.JWT_SECRET||'supersecret',{expiresIn:'1h'});
 key=(await req('/hash-store/config')).publishable_api_key;
 const a=await vendor('A'),b=await vendor('B');
 await req('/admin/hash/promotions','POST',{action:'create',definition:definition({})},a.token,400); // no listings must never become store-wide
 const pa=await product(a),pb=await product(b);
 await req('/admin/hash/promotions','POST',{action:'create',definition:definition({product_ids:[pb.product_id]})},a.token,400);
 await req('/admin/hash/promotions','POST',{action:'create',definition:definition({vendor_id:b.vendor_id})},a.token,400);
 const global=await create(admin),p=await create(a.token);
 assert.equal((await req('/admin/hash/promotions','GET',undefined,a.token)).count,1);
 assert.equal((await req('/admin/hash/promotions?vendor_id='+a.vendor_id,'GET',undefined,b.token)).count,0);
 await state(p,'active',b.token,400);await state(global,'active',a.token,400);
 await req('/admin/promotions','GET',undefined,a.token,400);
 await state(p,'active',a.token);
 let all=await req('/admin/hash/promotions');const owned=all.promotions.find(x=>x.id===p.id);assert.equal(owned.vendor_id,a.vendor_id);
 assert.deepEqual(owned.application_method.target_rules[0].values.map(x=>x.value),[pa.product_id]);
 const region=(await req('/store/regions')).regions.find(r=>r.currency_code==='inr');
 const carts=[];for(const prod of [pa,pb])carts.push((await req('/store/carts','POST',{region_id:region.id,items:[{variant_id:prod.variant_id,quantity:1}]},null)).cart);
 const apply=async(cart,codes)=>(await req('/store/carts/'+cart.id+'/promotions','POST',{promo_codes:codes},null)).cart;
 assert.equal(Number((await apply(carts[0],[p.code])).discount_total),10);
 assert.equal(Number((await apply(carts[1],[p.code])).discount_total),0);
 const auto=await create(a.token,{automatic:true,value:5});await state(auto,'active',a.token);
 assert.equal(Number((await apply(carts[0],[])).discount_total),5);
 assert.equal(Number((await apply(carts[1],[])).discount_total),0);
 await state(owned,'inactive');assert.equal((await req('/admin/hash/promotions','GET',undefined,a.token)).promotions.find(x=>x.id===p.id).status,'inactive');
 const latest=(await req('/admin/hash/promotions','GET',undefined,a.token)).promotions.find(x=>x.id===auto.id);await state(latest,'inactive',a.token);
 assert.equal(Number((await apply(carts[0],[p.code])).discount_total),0);
 fs.writeFileSync('.local/vendor-promotion-ui.json',JSON.stringify({email:a.email,password:a.password}),{mode:0o600});
 console.log('PASS vendor creation/activation, empty-scope ownership, cross-vendor denial, global-offer isolation, native-admin denial, coupon and automatic cart isolation, Hash override and vendor deactivation.');
 }finally{for(const id of created){await req('/admin/promotions/'+id,'DELETE').catch(()=>{});await db.query('DELETE FROM hash_promotion_owner WHERE promotion_id=$1',[id])}for(const id of products)await req('/admin/hash','POST',{action:'review_product',product_id:id,approval:'rejected',review_note:'Local vendor promotion test complete'}).catch(()=>{});await db.end()}
})().catch(e=>{console.error(e.message);process.exitCode=1});
