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

test('explicit partial result is rendered with translation and warning, never called quality checked',async()=>{
 const data={ok:true,pipeline:'letter-evidence-v1',qualityChecked:false,analysisStatus:'partial',summary:'Kontrola nie została zakończona.',analysisWarning:'Kontrola nie została zakończona.',translation:'Gotowe tłumaczenie'};
 const result=await request.request('/test',{},async()=>({ok:true,text:async()=>JSON.stringify(data)}));
 assert.equal(result.translation,'Gotowe tłumaczenie');assert.equal(result.qualityChecked,false);
 const invalid={...data,analysisWarning:''};await assert.rejects(request.request('/test',{},async()=>({ok:true,text:async()=>JSON.stringify(invalid)})));
});

test('review network failure preserves the completed draft translation and skips extra research',async()=>{
 const stages=[];
 const result=await request.request('/test',{mode:'letter',userLang:'PL',text:'source'},async(_url,opts)=>{
  const stage=JSON.parse(opts.body).letterStage;stages.push(stage);
  if(stage==='review')throw Error('offline');
  return {ok:true,text:async()=>JSON.stringify({ok:true,pipeline:'letter-evidence-v1',stage:'draft',draft:{translation:'Zachowane tłumaczenie',translationComplete:true,detectedLang:'NL',fallbackNotice:'Kontrola nie została zakończona. Sprawdź daty i kwoty.'}})};
 });
 assert.equal(result.analysisStatus,'partial');assert.equal(result.qualityChecked,false);assert.equal(result.translation,'Zachowane tłumaczenie');assert.match(result.summary,/Sprawdź daty/);assert.equal(result.fraudRisk.level,'UNKNOWN');assert.deepEqual(result.actions,[]);assert.deepEqual(stages,['draft','review']);
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

test('partial result remains visible in the real UI handler without consuming a free use',async()=>{
 const fs=require('fs'),vm=require('vm'),path=require('path');const html=fs.readFileSync(path.join(__dirname,'../index.html'),'utf8');
 const source=html.slice(html.indexOf('function sbClearLetterResult(){'),html.indexOf('(async function init(){',html.indexOf('function sbClearLetterResult(){')));
 const elements=new Map();const element=id=>{if(!elements.has(id))elements.set(id,{value:'',textContent:'',innerHTML:'',disabled:false,style:{},removeAttribute(){},appendChild(){},scrollIntoView(){}});return elements.get(id)};
 element('inputText').value='NOWE PISMO';element('sourceLang').value='AUTO';element('userLang').value='PL';let used=0;const events=[];
 const data={ok:true,pipeline:'letter-evidence-v1',qualityChecked:false,analysisStatus:'partial',analysisWarning:'Sprawdź daty i kwoty.',summary:'Sprawdź daty i kwoty.',translation:'ZACHOWANE TŁUMACZENIE',actions:[],consequences:[],help:[],risks:[],fraudRisk:{level:'UNKNOWN'},replyIntent:'NO_REPLY',replyGuidance:'Sprawdź wynik.',replies:{},repliesDocument:{},legalHelpNeeded:'NONE',urgency:'UNKNOWN'};
 const noop=()=>{};
 const context={document:{getElementById:element,createElement:()=>element('created')},window:{SBLetterRequest:{request:async()=>data,message:request.message}},UI:{lang:'PL',dict:{PL:{}}},ENDPOINTS:{analyze:'/test'},checkPaywall:()=>true,sbRegionCode:()=>'',sbTelemetryAccessType:()=>'',sbShowNotice:noop,trackEvent:e=>events.push(e),consumeFreeIfNeeded:()=>used++,setTimeout:()=>0,fetch:async()=>({}),sbGetResultLang:()=> 'PL',sbResultText:key=>key,sbUx10Text:key=>key,safeArr:x=>Array.isArray(x)?x:[],sbUniqueStrings:x=>x||[],renderTopInsightSafeV2:noop,renderFraudRisk:noop,renderInstitution:noop,sbApplyResultUxPatchV9:noop,refreshUI:noop,updatePaidMessage:noop};
 vm.runInNewContext(source,context);await context.analyze();
 assert.equal(element('translation').textContent,'ZACHOWANE TŁUMACZENIE');assert.equal(element('summary').textContent,data.analysisWarning);assert.equal(used,0);assert.ok(!events.includes('analysis_error'));assert.equal(element('legalStatus').style.display,'none');
});

test('communication risks stay visible and expanded after rendering a result',()=>{
 const fs=require('fs'),vm=require('vm'),path=require('path'),html=fs.readFileSync(path.join(__dirname,'../index.html'),'utf8');
 const source=html.slice(html.indexOf('function sbPolishResultView(data){'),html.indexOf('function sbClearLetterResult(){'));
 const cards=new Map(),card=id=>{if(!cards.has(id))cards.set(id,{hidden:true,style:{display:'none'},open:false,removeAttribute(name){if(name==='open')this.open=false},setAttribute(name){if(name==='open')this.open=true}});return cards.get(id)};
 const context={document:{getElementById:card},sbFraudLevelFromData:data=>data.fraudRisk?.level||'UNKNOWN'};vm.runInNewContext(source,context);
 for(const data of [{fraudRisk:{level:'LOW'}},{analysisStatus:'partial',fraudRisk:{level:'UNKNOWN'}},{fraudRisk:{level:'HIGH'}}]){
  context.sbPolishResultView(data);assert.equal(card('risksAccordion').hidden,false);assert.equal(card('risksAccordion').style.display,'block');assert.equal(card('risksAccordion').open,true);
 }
 const hiddenRule=html.slice(html.indexOf('body.sb-simple-view #fraudInfoCard,'),html.indexOf('body.sb-simple-view.sb-access-locked'));
 assert.doesNotMatch(hiddenRule,/#risksAccordion/);
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
test('web-confirmed primary institution replaces unverified country and site, retaining the complete result',async()=>{
 const inst={name:'National Tax Agency',country:'JP',officialWebsite:'https://www.nta.go.jp/',verification:'web',sources:[{url:'https://www.nta.go.jp/'}]};
 const result=await request.request('/test',{mode:'letter',text:'National Tax Agency'},async(u,o)=>{
 const stage=JSON.parse(o.body).letterStage;
 const data=stage==='draft'?{ok:true,pipeline:'letter-evidence-v1',stage:'draft',draft:{}}:stage==='institutions'?{ok:true,status:'verified',institutions:[inst]}:{ok:true,pipeline:'letter-evidence-v1',qualityChecked:true,summary:'Complete',translation:'Complete',institution:{name:'National Tax Agency',country:'',officialWebsite:''}};
 return {ok:true,text:async()=>JSON.stringify(data)};
 });assert.equal(result.institution.country,'JP');assert.equal(result.institution.officialWebsite,inst.officialWebsite);assert.equal(result.summary,'Complete');
});

