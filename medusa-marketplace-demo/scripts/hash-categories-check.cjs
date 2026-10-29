// Local-only HTTP check. Never points at a hosted database or service.
require('dotenv').config({quiet:true});
const assert=require('node:assert/strict'),fs=require('fs');
const pool=new(require('pg').Pool)({connectionString:'postgres://marketplace:super-secure-password@127.0.0.1:5433/marketplace'});
const base='http://localhost:9000';let admin,key,productId,category;
async function req(path,method='GET',body,token=admin,status=200){const r=await fetch(base+path,{method,headers:{'content-type':'application/json',...(key?{'x-publishable-api-key':key}:{}),...(token?{authorization:'Bearer '+token}:{})},...(body?{body:JSON.stringify(body)}:{})});const d=await r.json();assert.equal(r.status,status,`${path}: ${JSON.stringify(d)}`);return d}
(async()=>{try{
 const {rows:[u]}=await pool.query(`SELECT id FROM "user" WHERE metadata->>'is_super_admin'='true' AND deleted_at IS NULL LIMIT 1`);
 admin=require('jsonwebtoken').sign({actor_id:u.id,actor_type:'user',auth_identity_id:'local-category-qa'},process.env.JWT_SECRET||'supersecret',{expiresIn:'1h'});
 key=(await req('/hash-store/config')).publishable_api_key;
 const credentials=JSON.parse(fs.readFileSync('.local/vendor-promotion-ui.json'));
 const token=(await req('/auth/user/emailpass','POST',credentials,null)).token;
 const vendor=(await req('/admin/hash','GET',undefined,token)).actor.vendor_id;
 const definition={name:'Category QA',handle:'qa-category-'+Date.now(),rank:5,is_active:true};
 await req('/admin/hash/categories','POST',definition,token,400);
 category=(await req('/admin/hash/categories','POST',definition)).category;
 const choice=(await req('/admin/hash/categories','GET',undefined,token)).categories.find(c=>c.id===category.id);assert.equal(choice.name,definition.name);assert.equal(choice.handle,definition.handle);assert.equal(choice.is_active,true);
 const product={action:'save_product',vendor_id:vendor,title:'Category QA listing',kind:'service',price_inr:10,stock:1,category_ids:[category.id]};
 productId=(await req('/admin/hash','POST',product,token)).result.product_id;
 await req('/admin/hash','POST',{action:'review_product',product_id:productId,approval:'approved'});
 let results=await req('/store/hash/products?category_id='+category.id);
 assert.equal(results.count,1);assert.equal(results.products[0].product_id,productId);assert.equal(results.products[0].categories[0].id,category.id);
 const native=await req('/store/products?category_id[]='+category.id);
 assert(native.products.some(p=>p.id===productId));
 const {category_ids,...legacy}=product;await req('/admin/hash','POST',{...legacy,product_id:productId},token);
 assert((await req('/admin/hash','GET',undefined,token)).products.find(p=>p.product_id===productId).categories.some(c=>c.id===category.id));
 await req('/admin/hash/categories','POST',{...definition,id:category.id,is_active:false});
 assert(!(await req('/store/hash/categories')).categories.some(c=>c.id===category.id));
 await req('/admin/hash','POST',{...product,product_id:productId},token,400);
 const states=await req('/hash-store/locations?country_code=in');assert.equal(states.states.length,36);
 await req('/hash-store/locations?country_code=xx','GET',undefined,null,400);
 console.log('PASS: vendor category permissions, native assignment, custom and native catalog filters, legacy update preservation, hidden-category rejection, India states and invalid-country handling.');
 }finally{if(productId)await req('/admin/hash','POST',{action:'review_product',product_id:productId,approval:'rejected',review_note:'Local category test completed'}).catch(()=>{});await pool.end()}
})().catch(e=>{console.error(e.message);process.exitCode=1});
