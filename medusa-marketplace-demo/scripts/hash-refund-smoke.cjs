const fs=require('fs'),assert=require('node:assert/strict');const f=JSON.parse(fs.readFileSync('.local/hash-test-fixture.json')),o=JSON.parse(fs.readFileSync('.local/hash-order-test.json'));
async function req(path,body,expected=200){const r=await fetch('http://localhost:9000'+path,{method:'POST',headers:{'content-type':'application/json',authorization:'Bearer '+f.token},body:JSON.stringify(body)});const d=await r.json();assert.equal(r.status,expected,JSON.stringify(d));return d}
(async()=>{
 const cp=require('child_process');const result=cp.spawnSync('node_modules/.bin/medusa',['exec','./src/scripts/hash-test-refund.ts'],{env:{...process.env,DATABASE_URL:'postgres://marketplace:super-secure-password@127.0.0.1:5433/marketplace'},encoding:'utf8'});assert.equal(result.status,0,result.stderr||result.stdout);
 await req('/admin/hash',{action:'reconcile'});
 const state=await fetch('http://localhost:9000/admin/hash',{headers:{authorization:'Bearer '+f.token}}).then(r=>r.json());const order=state.orders.find(x=>x.order_id===o.order_id);assert.equal(order.hold_reason,'Refund requires Hash review');
 const paidBefore=state.settlements.filter(s=>s.order_id===o.order_id&&s.status==='paid').reduce((n,s)=>n+Number(s.amount_paise),0);
 const unpaid=state.settlements.find(s=>s.order_id===o.order_id&&s.status!=='paid');
 await req('/admin/hash',{action:'record_payout',settlement_id:unpaid.id,reference:'REFUND-BLOCKED'},400);
 const review=await req('/admin/hash',{action:'review_adjustment',order_id:o.order_id,note:'QA verified refund and adjusted remaining balance'});assert.equal(review.result.net_paise,20101);assert.equal(review.result.recovery_paise,Math.max(0,paidBefore-20101));
 await req('/admin/hash',{action:'reconcile'});
 const final=await fetch('http://localhost:9000/admin/hash',{headers:{authorization:'Bearer '+f.token}}).then(r=>r.json());const adjusted=final.settlements.find(s=>s.id===unpaid.id);assert.equal(Number(adjusted.amount_paise),0);assert.equal(adjusted.hold_reason,null);
 await req('/admin/hash',{action:'record_payout',settlement_id:unpaid.id,reference:'REFUND-ZERO'},400);
 console.log('PASS refund hold, blocked payout, audited adjustment, overpayment recovery and zero-payout protection.');
})().catch(e=>{console.error(e);process.exitCode=1});
