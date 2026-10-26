const cp=require('child_process'),path=require('path');
const demoMode=process.env.HASH_DEMO_MODE==='true';
if(!demoMode && !process.env.REDIS_URL)throw new Error('REDIS_URL is required outside demo mode');
if(demoMode){delete process.env.REDIS_URL;console.warn('DEMO MODE: in-memory processing; not for live transactions.')}
for(const key of ['DATABASE_URL','STORE_CORS','ADMIN_CORS','AUTH_CORS','JWT_SECRET','COOKIE_SECRET','HASH_OTP_SECRET']){
 if(!process.env[key])throw new Error(`${key} is required for production`);
}
for(const key of ['JWT_SECRET','COOKIE_SECRET','HASH_OTP_SECRET']){
 if(process.env[key].length<32 || /replace-with|supersecret|local-development/.test(process.env[key]))throw new Error(`${key} must be a strong, non-placeholder secret`);
}
for(const key of ['STORE_CORS','ADMIN_CORS','AUTH_CORS']){
 if(process.env[key].includes('*'))throw new Error(`${key} must use explicit allowed origins`);
}
if(process.env.HASH_ADMIN_EMAIL && (!process.env.HASH_ADMIN_PASSWORD || process.env.HASH_ADMIN_PASSWORD.length<12 || process.env.HASH_ADMIN_PASSWORD.includes('replace-with')))throw new Error('Provide a strong initial admin password');
// Node's 250 ms address-attempt timeout is too short for cross-region DB connections.
if(!process.env.NODE_OPTIONS?.includes('--network-family-autoselection-attempt-timeout')){
 process.env.NODE_OPTIONS=[process.env.NODE_OPTIONS,'--network-family-autoselection-attempt-timeout=2000'].filter(Boolean).join(' ');
}
const cwd=path.resolve(__dirname,'../.medusa/server');
const bin=path.resolve(__dirname,'../node_modules/.bin/medusa');
let child;
let stopping = false;
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>{stopping=true;child?.kill(signal)});
function run(args){return new Promise((resolve,reject)=>{child=cp.spawn(bin,args,{cwd,env:process.env,stdio:'inherit'});child.on('error',reject);child.on('exit',code=>code===0?resolve():reject(new Error(`Medusa ${args[0]} exited with ${code}`)))});}
(async()=>{
 if(process.env.HASH_RUN_MIGRATIONS!=='false'){
  await run(['db:migrate']);
  await run(['exec','./src/scripts/hash-setup.js']);
 }
 for(let attempt=1;attempt<=3;attempt++){
  try{await run(['start']);break;}catch(error){
   if(stopping || attempt===3)throw error;
   console.warn(`Server start failed; retrying in ${attempt*5}s (${attempt}/3). Migrations will not be repeated.`);
   await new Promise(resolve=>setTimeout(resolve,attempt*5000));
   if(stopping)break;
  }
 }
})().catch(e=>{console.error(e.message);process.exit(1)});
