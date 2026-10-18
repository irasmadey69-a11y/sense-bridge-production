const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const dir=path.resolve(__dirname,'../netlify/functions');
function harness({brand=true,fail=false,throwMail=false}={}){
  const maps=new Map(),calls=[];
  const env={ADMIN_PIN:'test-pin',RESEND_API_KEY:'legacy-test',...(brand?{SB_RESEND_API_KEY:'brand-test'}:{})};
  const getStore=({name})=>{if(!maps.has(name))maps.set(name,new Map());const m=maps.get(name);return {
    get:async k=>m.get(k)||null,getWithMetadata:async k=>m.has(k)?{data:m.get(k),etag:'1'}:null,
    set:async(k,v)=>{m.set(k,v);return {modified:true};}
  }};
  function load(file){
    const box={module:{exports:{}},process:{env},Date,AbortSignal,setTimeout,console:{error(){}},
      fetch:async(url,opts)=>{calls.push({url,...opts,payload:JSON.parse(opts.body)});if(throwMail)throw Error('network');return {ok:!fail,status:503};},
      require:n=>n==='@netlify/blobs'?{getStore,connectLambda(){}}:n==='./_mail'?load('_mail.js'):n.startsWith('.')?require(path.join(dir,n)):require(n)};
    box.exports=box.module.exports;vm.runInNewContext(fs.readFileSync(path.join(dir,file),'utf8'),box);return box.module.exports;
  }
  const run=async(file,body)=>{const response=await load(file).handler({httpMethod:'POST',body:JSON.stringify(body)},{});return {status:response.statusCode,...JSON.parse(response.body)};};
  return {calls,maps,load,run,getStore};
}
test('branded request reaches both admin inboxes with Reply-To and stable retry identity',async()=>{
  const h=harness(),mail=h.load('_mail.js'),data={email:'test@example.com',createdAt:123,requestCount:2};
  assert.equal((await mail.sendRequest(data)).sent,true);await mail.sendRequest(data);
  const a=h.calls[0];assert.deepEqual(a.payload.to,['madey.verpakken@gmail.com','sensebridge.official@gmail.com']);
  assert.equal(a.payload.from,'Sense Bridge <powiadomienia@sensebridge.app>');assert.equal(a.payload.reply_to,'sensebridge.official@gmail.com');
  assert.equal(a.headers.Authorization,'Bearer brand-test');assert.equal(a.headers['Idempotency-Key'],h.calls[1].headers['Idempotency-Key']);assert.ok(a.signal);
});
test('legacy notification remains available without the new credential',async()=>{
  const h=harness({brand:false});assert.equal((await h.load('_mail.js').sendRequest({email:'test@example.com',createdAt:123})).sent,true);
  assert.deepEqual(h.calls[0].payload.to,['madey.verpakken@gmail.com']);assert.equal(h.calls[0].headers.Authorization,'Bearer legacy-test');
});
for(const [file,body,status] of [['access_set.js',{plan:'24h'},'ACTIVE'],['access_bonus.js',{},'BONUS'],['access_beta.js',{},'BETA']]){
  test(file+': valid admin grant sends separate user/admin mail; invalid PIN cannot grant or send',async()=>{
    const h=harness(),email='test@example.com';
    for(const adminPin of ['', 'wrong'])assert.equal((await h.run(file,{...body,email,adminPin})).status,403);
    assert.equal(h.calls.length,0);
    const result=await h.run(file,{...body,email,adminPin:'test-pin'});
    assert.equal(result.ok,true);assert.equal(result.emailSent,true);assert.equal(result.adminEmailSent,true);
    assert.equal(JSON.parse(await h.getStore({name:'sb-users'}).get(email)).status,status);
    assert.equal(h.calls.length,2);assert.deepEqual(h.calls[0].payload.to,[email]);assert.equal(h.calls[1].payload.to.length,2);
    assert.notEqual(h.calls[0].headers['Idempotency-Key'],h.calls[1].headers['Idempotency-Key']);
  });
  test(file+': upstream rejection and network failure never undo a saved grant',async()=>{
    for(const config of [{fail:true},{throwMail:true}]){
      const h=harness(config),email='test@example.com',result=await h.run(file,{...body,email,adminPin:'test-pin'});
      assert.equal(result.ok,true);assert.equal(result.emailSent,false);assert.equal(result.adminEmailSent,false);
      assert.equal(JSON.parse(await h.getStore({name:'sb-users'}).get(email)).status,status);
    }
  });
}
test('bonus does not downgrade BETA access or lose request metadata',async()=>{
  const h=harness(),s=h.getStore({name:'sb-users'});await s.set('test@example.com',JSON.stringify({status:'BETA',requestCount:4,requestLang:'DE'}));
  const r=await h.run('access_bonus.js',{email:'test@example.com',adminPin:'test-pin'});
  assert.equal(r.status,'BETA');assert.equal(r.requestCount,4);assert.equal(r.bonusUsesGranted,3);
  assert.match(h.calls[0].payload.subject,/access activated/);
});
test('email HTML escapes untrusted text and activation failure reports a clear missing-key warning',async()=>{
  const h=harness({brand:false});const r=await h.load('_mail.js').sendActivation({email:'test@example.com',plan:'BONUS',createdAt:123});
  assert.equal(r.sent,false);assert.equal(r.adminEmailSent,true);assert.match(r.error,/SB_RESEND_API_KEY/);
  await h.load('_mail.js').sendRequest({email:'<img onerror=1>@example.com',createdAt:123});
  assert.ok(!h.calls[1].payload.html.includes('<img'));assert.match(h.calls[1].payload.html,/&lt;img/);
});
