const cp=require('child_process'),path=require('path');
for(const key of ['DATABASE_URL','REDIS_URL','STORE_CORS','ADMIN_CORS','AUTH_CORS','JWT_SECRET','COOKIE_SECRET','HASH_OTP_SECRET']){
 if(!process.env[key])throw new Error(`${key} is required for production`);
}
for(const key of ['JWT_SECRET','COOKIE_SECRET','HASH_OTP_SECRET']){
 if(process.env[key].length<32 || /replace-with|supersecret|local-development/.test(process.env[key]))throw new Error(`${key} must be a strong, non-placeholder secret`);
}
for(const key of ['STORE_CORS','ADMIN_CORS','AUTH_CORS']){
 if(process.env[key].includes('*'))throw new Error(`${key} must use explicit allowed origins`);
}
if(process.env.HASH_ADMIN_EMAIL && (!process.env.HASH_ADMIN_PASSWORD || process.env.HASH_ADMIN_PASSWORD.length<12 || process.env.HASH_ADMIN_PASSWORD.includes('replace-with')))throw new Error('Provide a strong initial admin password');
const cwd=path.resolve(__dirname,'../.medusa/server');
const bin=path.resolve(__dirname,'../node_modules/.bin/medusa');
let child;
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>child?.kill(signal));
function run(args){return new Promise((resolve,reject)=>{child=cp.spawn(bin,args,{cwd,env:process.env,stdio:'inherit'});child.on('error',reject);child.on('exit',code=>code===0?resolve():reject(new Error(`Medusa ${args[0]} exited with ${code}`)))});}
(async()=>{
 if(process.env.HASH_RUN_MIGRATIONS!=='false'){
  await run(['db:migrate']);
  await run(['exec','./src/scripts/hash-setup.js']);
 }
 await run(['start']);
})().catch(e=>{console.error(e.message);process.exit(1)});
