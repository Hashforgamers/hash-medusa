const cp=require('child_process');
function run(args){const r=cp.spawnSync('docker',args,{stdio:'inherit'});if(r.status!==0)process.exit(r.status||1)}
if(cp.spawnSync('docker',['inspect','medusa-local-postgres'],{stdio:'ignore'}).status===0)run(['start','medusa-local-postgres']);
else run(['run','-d','--name','medusa-local-postgres','-e','POSTGRES_DB=marketplace','-e','POSTGRES_USER=marketplace','-e','POSTGRES_PASSWORD=super-secure-password','-p','127.0.0.1:5433:5432','-v','medusa-local-db-data:/var/lib/postgresql/data','postgres:15.3-alpine']);
