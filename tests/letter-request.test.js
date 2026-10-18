const {test}=require('node:test'),assert=require('node:assert/strict');
const request=require('../letter-request');
test('HTML gateway error becomes a readable error code, not a JSON parser message',async()=>{
 await assert.rejects(request.request('/test',{},async()=>({ok:false,status:502,text:async()=>'<HTML>Bad gateway</HTML>'})),e=>e.code==='LETTER_UPSTREAM'&&!e.message.includes('Unexpected token'));
 assert.match(request.message('PL','LETTER_UPSTREAM'),/Nie udało się/);
});
test('browser enforces a deadline even if the connection ignores abort',async()=>{
 await assert.rejects(request.request('/test',{},()=>new Promise(()=>{}),25),e=>e.code==='LETTER_TIMEOUT');
});
test('incomplete structured success and explicit API failure are rejected',async()=>{
 for(const data of [{ok:true,summary:'Test',pipeline:'letter-evidence-v1',qualityChecked:false,translation:'tekst'},{ok:false,errorCode:'LETTER_UNVERIFIED'}]){
  await assert.rejects(request.request('/test',{},async()=>({ok:true,text:async()=>JSON.stringify(data)})));
 }
});
test('complete result is accepted without requesting another translation',async()=>{
 let calls=0;const data={ok:true,pipeline:'letter-evidence-v1',qualityChecked:true,summary:'Wyjaśnienie',translation:'Tłumaczenie'};
 const result=await request.request('/test',{},async()=>{calls++;return{ok:true,text:async()=>JSON.stringify(data)}});assert.equal(result.summary,data.summary);assert.equal(calls,1);
});
test('failed browser analysis clears stale results, preserves source and counts one failure without consuming a use',async()=>{
 const fs=require('fs'),vm=require('vm'),path=require('path');const html=fs.readFileSync(path.join(__dirname,'../index.html'),'utf8');
 const source=html.slice(html.indexOf('function sbClearLetterResult(){'),html.indexOf('(async function init(){',html.indexOf('function sbClearLetterResult(){')));
 const elements=new Map();const element=id=>{if(!elements.has(id))elements.set(id,{value:'',textContent:'old result',disabled:false,style:{},removeAttribute(){}});return elements.get(id)};
 element('inputText').value='NOWE PISMO';element('sourceLang').value='AUTO';element('userLang').value='PL';const events=[],notices=[];let used=0;
 const context={document:{getElementById:element},window:{SBLetterRequest:{request:async()=>{const e=new Error('HTML');e.code='LETTER_UPSTREAM';throw e},message:request.message}},UI:{lang:'PL'},ENDPOINTS:{analyze:'/test'},checkPaywall:()=>true,sbRegionCode:()=>'',sbTelemetryAccessType:()=>'',sbShowNotice:s=>notices.push(s),trackEvent:e=>events.push(e),consumeFreeIfNeeded:()=>used++,setTimeout:()=>0};
 vm.runInNewContext(source,context);await context.analyze();
 assert.equal(element('inputText').value,'NOWE PISMO');assert.equal(element('summary').textContent,'');assert.equal(element('translation').textContent,'');assert.equal(element('btnAnalyze').disabled,false);assert.equal(used,0);assert.deepEqual(events,['analysis_error']);assert.match(notices[0],/Nie udało się/);
});

test('letter transport waits for review and never renders or accepts the draft as final',async()=>{
 const bodies=[];
 const result=await request.request('/test',{mode:'letter',text:'source'},async(_url,opts)=>{
  const body=JSON.parse(opts.body);bodies.push(body);
  const data=body.letterStage==='draft'?{ok:true,pipeline:'letter-evidence-v1',stage:'draft',draft:{translation:'draft only'}}:{ok:true,pipeline:'letter-evidence-v1',qualityChecked:true,summary:'Reviewed',translation:'complete'};
  return {ok:true,text:async()=>JSON.stringify(data)};
 });
 assert.equal(result.summary,'Reviewed');assert.deepEqual(bodies.map(x=>x.letterStage),['draft','review','institutions']);assert.deepEqual(bodies[1].letterDraft,{translation:'draft only'});
 await assert.rejects(request.request('/test',{mode:'letter'},async()=>({ok:true,text:async()=>JSON.stringify({ok:true,summary:'unreviewed'})})),e=>e.code==='LETTER_INCOMPLETE');
});

test('institution lookup failure preserves reviewed analysis and is explicitly reported',async()=>{
 const stages=[];const result=await request.request('/test',{mode:'letter',text:'Authority'},async(u,o)=>{
 const stage=JSON.parse(o.body).letterStage;stages.push(stage);
 if(stage==='institutions')throw Error('offline');
 return {ok:true,text:async()=>JSON.stringify(stage==='draft'?{ok:true,pipeline:'letter-evidence-v1',stage:'draft',draft:{}}:{ok:true,pipeline:'letter-evidence-v1',summary:'Complete',translation:'Complete',qualityChecked:true})};
 });assert.equal(result.summary,'Complete');assert.equal(result.institutionSearch.status,'unavailable');assert.deepEqual(stages,['draft','review','institutions']);
});
