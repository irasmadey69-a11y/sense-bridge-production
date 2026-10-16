const {test}=require('node:test');const assert=require('node:assert/strict');
const vm=require('node:vm'),fs=require('node:fs'),path=require('node:path');
const dir=path.resolve(__dirname,'../netlify/functions');
function storage(){
 const maps=new Map(),versions=new Map();
 const sdk={connectLambda(){},getStore({name}){
  if(!maps.has(name)){maps.set(name,new Map());versions.set(name,new Map());}
  const m=maps.get(name),v=versions.get(name);
  return {get:async k=>m.get(k)??null,getWithMetadata:async k=>m.has(k)?{data:m.get(k),etag:String(v.get(k)||1)}:null,
   list:async()=>({blobs:[...m.keys()].map(key=>({key}))}),
   set:async(k,data,opts={})=>{
    if(opts.onlyIfNew&&m.has(k))return {modified:false};
    if(opts.onlyIfMatch&&String(v.get(k)||1)!==opts.onlyIfMatch)return {modified:false};
    m.set(k,data);v.set(k,(v.get(k)||1)+1);return {modified:true,etag:String(v.get(k))};
   }};
 }};return {sdk,maps,store:n=>sdk.getStore({name:n})};
}
function load(file,db,fetcher=async()=>{throw Error('Unexpected external call')}){
 const context={exports:{},process:{env:{ADMIN_PIN:'test-pin',OPENAI_API_KEY:'test-only',RESEND_API_KEY:'test-only'}},URL,Date,AbortSignal,setTimeout,console:{error(){}},
  require(n){if(n==='@netlify/blobs')return db.sdk;if(n==='./_usage')return {recordUsage:async()=>({ok:true})};return n.startsWith('.')?require(path.join(dir,n)):require(n);},fetch:fetcher};
 vm.runInNewContext(fs.readFileSync(path.join(dir,file),'utf8'),context);return context.exports.handler;
}
const event=b=>({httpMethod:'POST',headers:{'x-nf-country':'NL'},body:JSON.stringify(b)});
const run=async(h,b)=>JSON.parse((await h(event(b),{})).body);
test('concurrent counters/maps preserve every increment and legacy values',async()=>{
 const db=storage(),a=require('../netlify/functions/_atomic-stats'),s=db.store('test');
 await s.set('count','100');await Promise.all(Array.from({length:20},()=>a.increment(s,'count')));
 assert.equal(await s.get('count'),'120');
 await Promise.all(Array.from({length:20},()=>a.incrementMap(s,'langs','PL')));
 assert.equal(JSON.parse(await s.get('langs')).PL,20);
});
test('all 28 permitted client events reach the matching admin field exactly once',async()=>{
 const db=storage(),track=load('track_event.js',db),stats=load('stats.js',db);
 const pairs={app_open:'appOpens',shortcut_add:'shortcutAdds',shortcut_click:'shortcutClicks',ocr_use:'ocrUses',return_user:'returnUsers',analysis_use:'analysisUses',access_request:'accessRequests',access_info_open:'accessInfoOpens',free_limit_reached:'freeLimitReached',ai_screenshot:'aiScreenshot',ai_link:'aiLink',ai_message:'aiMessage',ai_reply:'aiReply',ai_conversation:'aiConversation',ai_contract:'aiContract',ai_doc_pdf:'aiDocPdf',ai_doc_form:'aiDocForm',ai_doc_photo:'aiDocPhoto',ai_doc_bill:'aiDocBill',ai_doc_exercise:'aiDocExercise',ai_doc_options:'aiDocOptions',ai_doc_question:'aiDocQuestion',ai_doc_job:'aiDocJob',ai_job_ask:'aiJobAsk',ai_job_apply:'aiJobApply',ai_job_conversation:'aiJobConversation',ai_doc_unknown:'aiDocUnknown',ai_error:'aiErrors'};
 for(const e of Object.keys(pairs))assert.equal((await run(track,{event:e,lang:'PL'})).ok,true,e);
 const result=await run(stats,{adminPin:'test-pin'});
 for(const [e,field] of Object.entries(pairs))assert.equal(result[field],1,e+' -> '+field);
 assert.equal(result.breakdown.language.analysis_use.PL,1);assert.equal(result.breakdown.country.analysis_use.NL,1);
 assert.equal((await run(track,{event:'not-an-event'})).ok,false);
 assert.equal((await run(stats,{adminPin:'wrong'})).ok,false);
});
test('completed analysis counts once, with backwards compatibility for old clients',async()=>{
 const db=storage(),h=load('analyze_count.js',db);
 const invoke=async body=>JSON.parse((await h({...event(body),headers:{'x-sb-event':'analyze','x-nf-country':'NL'}},{})).body);
 assert.equal((await invoke({combined:true,lang:'PL'})).analyzes,1);
 assert.equal(await db.store('sb-stats').get('analysis_use'),'1');
 await invoke({}); // old clients send their own analysis_use event
 assert.equal(await db.store('sb-stats').get('analyzes'),'2');assert.equal(await db.store('sb-stats').get('analysis_use'),'1');
});
test('OCR counts successful new uploads, not failed or empty reads',async()=>{
 const db=storage();let text='Odczytany tekst';
 const h=load('ocr.js',db,async()=>({ok:true,json:async()=>({output_text:text})}));
 await run(h,{imageDataUrl:'data:image/png;base64,test',countOCR:true,uiLang:'PL'});
 assert.equal(await db.store('sb-stats').get('ocr_use'),'1');text='';await run(h,{imageDataUrl:'data:image/png;base64,test',countOCR:true});
 assert.equal(await db.store('sb-stats').get('ocr_use'),'1');
});
test('usage totals preserve simultaneous API calls and do not retain document content',async()=>{
 const db=storage();let ctx={module:{exports:{}},process:{env:{}},require:n=>n==='@netlify/blobs'?db.sdk:require(path.join(dir,n)),console:{error(){}},Date};
 vm.runInNewContext(fs.readFileSync(path.join(dir,'_usage.js'),'utf8'),ctx);
 const recorded=await Promise.all(Array.from({length:20},()=>ctx.module.exports.recordUsage(event({}),{}, {model:'gpt-4.1-mini',usage:{input_tokens:100,output_tokens:50},privateText:'SHOULD_NOT_BE_SAVED'},{feature:'EXERCISE_REVIEW',uiLang:'PL',documentLang:'NL',accessType:'PRO'})));
 for(const item of recorded)assert.equal(item.ok,true,item.error);
 const raw=await db.store('sb-usage').get('usage_summary_v1'),s=JSON.parse(raw);
 assert.equal(s.totalCalls,20);assert.equal(s.inputTokens,2000);assert.equal(s.outputTokens,1000);assert.equal(s.byFeature.EXERCISE_REVIEW.calls,20);assert.equal(s.byCountry.NL.calls,20);assert.equal(s.estimatedCostUsd,0.0024);assert.ok(!raw.includes('SHOULD_NOT_BE_SAVED'));
});
test('request retry uses the same idempotency key and cannot overwrite an activation',async()=>{
 const db=storage(),emails=[];let attempt=0;
 const h=load('pending_set.js',db,async(_url,opts)=>{
  emails.push(opts.headers['Idempotency-Key']);attempt++;
  if(attempt===1)return {ok:false,status:503,text:async()=>'temporary'};
  await db.store('sb-users').set('test@example.com',JSON.stringify({email:'test@example.com',status:'ACTIVE',plan:'30d-pro',expires:Date.now()+86400000}));
  return {ok:true,text:async()=>'{"id":"mail-test"}'};
 });
 const result=await run(h,{email:'test@example.com',lang:'PL'});
 assert.equal(result.requestSaved,true);assert.equal(result.emailSent,true);assert.equal(emails.length,2);assert.equal(emails[0],emails[1]);
 assert.equal(JSON.parse(await db.store('sb-users').get('test@example.com')).status,'ACTIVE');
 assert.equal(await db.store('sb-stats').get('access_request'),'1');assert.equal(await db.store('sb-stats').get('access_request_unique'),'1');
});
test('mail failure preserves request and diagnostics; active access sends no request mail',async()=>{
 const db=storage();let calls=0;const h=load('pending_set.js',db,async()=>{calls++;return {ok:false,status:503,text:async()=>'temporary'};});
 let result=await run(h,{email:'test@example.com'});assert.equal(result.requestSaved,true);assert.equal(result.emailSent,false);
 assert.equal(db.maps.get('sb-payments').size,1);assert.equal(JSON.parse(await db.store('sb-users').get('test@example.com')).status,'PENDING');
 await db.store('sb-users').set('active@example.com',JSON.stringify({status:'ACTIVE',expires:Date.now()+86400000}));
 result=await run(h,{email:'active@example.com'});assert.equal(result.requestSaved,false);assert.equal(calls,2);
});
test('admin request queue merges delivery diagnostics from the real request record',async()=>{
 const db=storage(),item={email:'test@example.com',createdAt:1,requestNumber:1,key:'request-key'};
 await db.store('sb-stats').set('access_requests_queue_v2',JSON.stringify([item]));
 await db.store('sb-payments').set('request-key',JSON.stringify({...item,emailSent:true}));
 const r=await run(load('admin_payments.js',db),{adminPin:'test-pin'});
 assert.equal(r.count,1);assert.equal(r.items[0].emailSent,true);assert.equal(r.items[0].key,'request-key');
});
test('admin user counts use effective expiry and preserve blocked/beta/bonus',async()=>{
 const db=storage();const rows=[['active',{status:'ACTIVE',expires:Date.now()+86400000}],['expired',{status:'ACTIVE',expires:1}],['blocked',{status:'BLOCKED',expires:1}],['beta',{status:'BETA'}],['bonus',{status:'BONUS'}],['pending',{status:'PENDING'}]];
 for(const [key,value] of rows)await db.store('sb-users').set(key,JSON.stringify(value));
 const r=await run(load('admin_list.js',db),{adminPin:'test-pin'});
 assert.equal(r.count,6);for(const key of ['ACTIVE','EXPIRED','BLOCKED','BETA','BONUS','PENDING'])assert.equal(r.counts[key],1);
});
test('main letter uses the reviewed facts and does not add a payment promise',async()=>{
 const db=storage(),calls=[];
 const base={detectedLang:'PL',translation:'',summary:'Pismo dotyczy uzupełnienia dokumentów.',documentTone:'formalny',responseRequired:'YES',urgency:'MEDIUM',actions:[],consequences:[],risks:[],help:[],helpLinks:[],nextSteps:[],legalHelpNeeded:'NONE',fraudRisk:{level:'LOW',confidence:30,label:'Brak silnych sygnałów',summary:'Nie potwierdzono autentyczności.',signals:[],suspiciousElements:[],safeSteps:[]},institution:{name:'',country:'',officialWebsite:'',confidence:0},detectedLinks:[],suspiciousLinks:[],detectedPhones:[],replies:{neutral:'Dziękuję za wiadomość. Proszę o wyjaśnienie.',polite:'Uprzejmie dziękuję za wiadomość. Proszę o wyjaśnienie.',firm:'Proszę o jednoznaczne wyjaśnienie wiadomości.'}};
 const checked={...base,summary:'Według pisma: pozostało 60 EUR do 30 listopada 2026; kopia zaświadczenia przed 20 listopada 2026.',actions:['Sprawdź informację o wpłacie 40 EUR i pozostałych 60 EUR.','Dostarcz kopię zaświadczenia przed 20 listopada 2026.']};
 const replies=[base,checked];
 const h=load('analyze.js',db,async(_url,options)=>{calls.push(JSON.parse(options.body));assert.ok(replies.length,'unexpected extra API call');return {ok:true,json:async()=>({status:'completed',output_text:JSON.stringify(replies.shift())})};});
 const r=await run(h,{text:'Przykład: 100 EUR minus wpłata 40 EUR. Pozostało 60 EUR do 30 listopada 2026. Kopia zaświadczenia przed 20 listopada 2026. Nie opisano kar ani konsekwencji. Nie podano zamiaru odpowiedzi użytkownika.',userLang:'PL',sourceLang:'PL'});
 assert.equal(r.ok,true);assert.match(r.summary,/60 EUR/);assert.match(r.summary,/20 listopada/);assert.equal(r.consequences.length,0);assert.doesNotMatch(JSON.stringify(r.replies),/Potwierdzam obecność|Zobowiązuję/);assert.ok(calls.length>=2);assert.match(calls[1].input,/QUALITY REVIEW/);assert.equal(calls[0].store,false);
});
test('browser event tracking sends the lexical language to the same deployment',async()=>{
 const src=fs.readFileSync(path.join(dir,'../../index.html'),'utf8');const a=src.indexOf('  async function trackEvent(eventName)'),b=src.indexOf('let deferredPrompt',a);const calls=[];
 const ctx={window:{},UI:{lang:'PL'},console:{log(){}},fetch:async(url,opts)=>{calls.push({url,body:JSON.parse(opts.body)});return {ok:true};}};
 vm.runInNewContext(src.slice(a,b),ctx);await ctx.trackEvent('app_open');assert.equal(calls[0].url,'/.netlify/functions/track_event');assert.equal(calls[0].body.lang,'PL');
});
test('activation and bonus are not reported failed when only their statistics fail',async()=>{
 const db=storage(),original=db.sdk.getStore;db.sdk.getStore=opts=>{const s=original(opts);if(opts.name==='sb-stats')s.set=async()=>{throw Error('statistics unavailable')};return s;};
 let mails=0;const h=load('access_set.js',db,async()=>{mails++;return {ok:true,text:async()=>'{"id":"test"}'}});
 const r=await run(h,{email:'test@example.com',adminPin:'test-pin',plan:'24h'});
 assert.equal(r.ok,true);assert.equal(r.emailSent,true);assert.equal(mails,1);assert.equal(JSON.parse(await db.store('sb-users').get('test@example.com')).status,'ACTIVE');
 const bonus=await run(load('access_bonus.js',db),{email:'bonus@example.com',adminPin:'test-pin'});assert.equal(bonus.ok,true);assert.equal(bonus.bonusUsesGranted,3);
});
test('saved access requests are not masked by an older click counter',async()=>{
 const db=storage();await db.store('sb-stats').set('access_request','1');await db.store('sb-payment-stats').set('payment_clicks_total',JSON.stringify({total:35}));
 const r=await run(load('stats.js',db),{adminPin:'test-pin'});
 assert.equal(r.accessRequests,1);assert.equal(r.legacyAccessRequests,35);
});
test('French indépendant and café do not identify Dutch IND or French CAF',()=>{
 const context={exports:{},require:()=>({}),process:{env:{}},URL,console};
 vm.runInNewContext(fs.readFileSync(path.join(dir,'analyze.js'),'utf8'),context);
 for(const text of ['Vous êtes indépendant : fournissez une attestation.','Rendez-vous au café.']){
  const result=context.applyGlobalInstitutionRecognitionV2({name:'IND',country:'NL',officialWebsite:'https://ind.nl',confidence:95},text,[]);
  assert.equal(result.name,'');assert.equal(result.country,'');
 }
 const real=context.applyGlobalInstitutionRecognitionV2({name:'',country:'',officialWebsite:'',confidence:0},'IND vous demande un document.',[]);
 assert.match(real.name,/IND/);assert.equal(real.country,'NL');
});
function installHarness({native=true,shell=false}={}){
 const events={},tracked=[];let prompts=0,resolveChoice;
 function node(){return {style:{},dataset:{},open:false,appendChild(){},setAttribute(){},addEventListener(){},replaceChildren(){},contains(){return false},querySelector(){return null},showModal(){this.open=true},close(){this.open=false},focus(){}};}
 const context={window:{SB_I18N:{modules:{install_24:{PL:{},EN:{}}}},addEventListener:(name,fn)=>{events[name]=fn},matchMedia:()=>({addEventListener(){}})},navigator:{userAgent:'Android'},screen:{width:400,height:800},document:{readyState:'loading',activeElement:node(),documentElement:{},body:node(),getElementById:()=>node(),createElement:node,addEventListener(){}},UI:{lang:'PL'},sbIsStoreShell:()=>shell,trackEvent:e=>tracked.push(e),URLSearchParams,location:{search:''},deferredPrompt:native?{prompt:async()=>{prompts++},userChoice:new Promise(r=>{resolveChoice=r})}:null};
 vm.runInNewContext(fs.readFileSync(path.join(dir,'../../install-guide.js'),'utf8'),context);
 return {context,events,tracked,prompts:()=>prompts,choice:v=>resolveChoice({outcome:v})};
}
test('install click is separate from completion; acceptance waits for appinstalled and duplicate event is ignored',async()=>{
 const h=installHarness();const waiting=h.context.window.SBInstall.open();h.context.window.SBInstall.open();
 assert.deepEqual(h.tracked,['shortcut_click']);assert.equal(h.prompts(),1);
 h.choice('accepted');await waiting;assert.deepEqual(h.tracked,['shortcut_click']);
 h.events.appinstalled();h.events.appinstalled();assert.deepEqual(h.tracked,['shortcut_click','shortcut_add']);
 h.context.window.SBInstall.open();assert.equal(h.tracked.length,2);
});
test('cancelled native prompt and manual guide count only the click; installed shell counts neither',async()=>{
 const h=installHarness();const waiting=h.context.window.SBInstall.open();h.choice('dismissed');await waiting;
 assert.deepEqual(h.tracked,['shortcut_click']);
 const manual=installHarness({native:false});manual.context.window.SBInstall.open();assert.deepEqual(manual.tracked,['shortcut_click']);
 const installed=installHarness({shell:true});installed.context.window.SBInstall.open();assert.deepEqual(installed.tracked,[]);
});
test('Elisabeth and German Gesetz do not imply ETZ hospital; explicit ETZ still recognized',()=>{
 const c={exports:{},require:()=>({}),process:{env:{}},URL,console};vm.runInNewContext(fs.readFileSync(path.join(dir,'analyze.js'),'utf8'),c);
 for(const text of ['Madame Elisabeth demande une copie.','Nach diesem Gesetz müssen Sie antworten.']){
  const i={name:'',country:'',officialWebsite:'',confidence:0};c.applyKnownInstitutionFix(i,text);
  assert.equal(i.name,'');assert.equal(c.classifyDocumentContext(text).medicalAppointment,false);
 }
 for(const text of ['ETZ vraagt uw documenten.','Elisabeth-TweeSteden Ziekenhuis','MijnETZ']){
  const i={name:'',country:'',officialWebsite:'',confidence:0};c.applyKnownInstitutionFix(i,text);assert.equal(i.country,'NL');assert.match(i.name,/Ziekenhuis/);
 }
});
test('unsupported high-confidence institution cannot override a source-backed registry match',()=>{
 const c={exports:{},require:()=>({}),process:{env:{}},URL,console};vm.runInNewContext(fs.readFileSync(path.join(dir,'analyze.js'),'utf8'),c);
 const i={name:'Invented Agency',country:'US',officialWebsite:'https://wrong.example',confidence:95};
 c.applyGlobalInstitutionRecognitionV2(i,'Belastingdienst vraagt een document.',[]);
 assert.equal(i.name,'Belastingdienst');assert.equal(i.country,'NL');assert.match(i.officialWebsite,/belastingdienst\.nl/);
});
