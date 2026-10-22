const {test}=require('node:test'),assert=require('node:assert/strict');
const engine=require('../netlify/functions/_letter-analysis'),fixture=require('./letter-fixtures');
function security(fraudRisk){return {fraudRisk,risks:[],communicationRiskNotice:'Nie wykryto wyraźnych ryzyk komunikacyjnych.'};}
function run(values,extra={}){const requests=[];return {requests,result:engine.analyze({key:'test',text:fixture.source,userLang:'PL',sourceLang:'PL',independentRiskReview:true,fetcher:async(url,options)=>{requests.push(JSON.parse(options.body));const v=values.shift();if(v instanceof Error)throw v;return fixture.api(v);},recordUsage:async()=>{},...extra})};}
test('independent security review catches theft omitted by translation and explanation passes',async()=>{
 const text='Send your password in your reply.',d=fixture.draft();Object.assign(d,{translation:'Wyślij swoje hasło w odpowiedzi.',detectedLang:'EN',facts:[],summary:'Nadawca żąda hasła.',actions:[{text:'Wyślij hasło.',quotes:[text]}]});d.fraudRisk.level='LOW';
 const risk={...d.fraudRisk,level:'HIGH',findings:[{kind:'SECRET_DISCLOSURE',quote:text,polarity:'AFFIRMATIVE',severity:'HIGH',explanation:'Żądanie przesłania hasła w odpowiedzi.'}],safeSteps:['Nie przesyłaj hasła.']};
 const h=run([d,fixture.review(d),security(risk)],{text,sourceLang:'EN'}),out=await h.result;
 assert.equal(h.requests.length,3);assert.equal(out.fraudRisk.level,'HIGH');assert.equal(out.replyIntent,'NO_REPLY');assert.deepEqual(out.actions,['Nie przesyłaj hasła.']);assert.equal(out.translation,d.translation);
 assert.match(h.requests[2].input[0].content,/ONLY task is fraud/);assert.doesNotMatch(h.requests[2].input[0].content,/COMPLETE translation/);assert.match(h.requests[2].input[0].content,/Inspect EVERY URL/);assert.doesNotMatch(h.requests[2].input[1].content,/"confidence"/);
});
test('independent normal-letter assessment replaces an unsupported alarm without losing facts',async()=>{
 const r=fixture.review();r.fraudRisk.level='HIGH';const risk={...fixture.draft().fraudRisk,level:'LOW',summary:'Brak silnych sygnałów oszustwa.'};
 const out=await run([fixture.draft(),r,security(risk)]).result;assert.equal(out.fraudRisk.level,'LOW');assert.match(out.summary,/60 EUR/);assert.equal(out.actionRequired,'YES');
});
test('security review failure preserves translation and does not publish an unreviewed safe verdict',async()=>{
 const out=await run([fixture.draft(),fixture.review(),new Error('security unavailable')]).result;assert.equal(out.analysisStatus,'partial');assert.equal(out.qualityChecked,false);assert.equal(out.translation,fixture.source);assert.equal(out.fraudRisk.level,'UNKNOWN');
});
test('unverified authentication advice without a literal URL is withheld while attendance remains',()=>{
 const {adjudicate}=require('../netlify/functions/_letter-risk');const quote='Use your usual credentials.',c={fraudRisk:{level:'LOW',findings:[{kind:'LOGIN',quote,polarity:'AFFIRMATIVE',severity:'LOW',explanation:'Normal login instruction.'}]},actions:[{text:'Log in using your credentials.',quotes:[quote]},{text:'Attend at 10:00.',quotes:['10:00']}],help:['Log in before attending.']};
 adjudicate(c,quote+' https://portal.example/login',{safeSteps:()=>['Avoid links','Avoid secrets','Verify independently']});assert.deepEqual(c.actions.map(x=>x.text),['Verify independently','Attend at 10:00.']);assert.deepEqual(c.help,['Verify independently']);assert.equal(c.fraudRisk.level,'LOW');
});

test('incomplete review cannot promote draft login findings to a safe verdict',()=>{const {adjudicate}=require('../netlify/functions/_letter-risk');const c={fraudRisk:{level:'UNKNOWN',findings:[{kind:'LOGIN',quote:'Log in normally.',polarity:'AFFIRMATIVE',severity:'LOW',explanation:'Normal login.'}]}};adjudicate(c,'Log in normally.',{incomplete:true});assert.equal(c.fraudRisk.level,'UNKNOWN');});

test('a suspicious login finding is not discarded merely because its category is LOGIN',()=>{const {adjudicate}=require('../netlify/functions/_letter-risk'),c=fixture.review(),quote='Enter password and SMS code within two hours.';c.fraudRisk={...c.fraudRisk,level:'MEDIUM',findings:[{kind:'LOGIN',quote,polarity:'AFFIRMATIVE',severity:'MEDIUM',explanation:'Podejrzany portal wymaga hasła i kodu pod presją czasu.'}]};c.actions=[{text:'Wpisz hasło i kod SMS.',quotes:[quote]}];adjudicate(c,quote,{safeSteps:()=>['Avoid links','Avoid secrets','Verify independently']});const out=engine.project(c,quote,'EN','PL','EN');assert.equal(out.fraudRisk.level,'MEDIUM');assert.deepEqual(out.actions,['Verify independently']);assert.equal(out.replyIntent,'NO_REPLY');assert.match(out.summary,/Niepotwierdzone twierdzenia/);assert.equal(out.safetyMode,'VERIFY_OFFICIAL');});
