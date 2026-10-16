const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const root=path.resolve(__dirname,'..');
const dir=path.join(root,'netlify/functions');
function load(name,responses){
 const calls=[];
 const ctx={exports:{},module:{exports:{}},process:{env:{OPENAI_API_KEY:'test-only'}},URL,AbortSignal,Date,console,
  require(n){if(n==='./_usage')return {recordUsage:async()=>{}}; return n.startsWith('.')?require(path.join(dir,n)):require(n);},
  fetch:async(url,options)=>{calls.push(JSON.parse(options.body));const d=responses.shift();assert.ok(d,'unexpected API call');return {ok:true,json:async()=>d};}};
 vm.runInNewContext(fs.readFileSync(path.join(dir,name),'utf8'),ctx);
 return {api:name.startsWith('_')?ctx.module.exports:ctx.exports,calls};
}
const done=v=>({status:'completed',output_text:JSON.stringify(v)});
test('URL facts distinguish real host, embedded government domain and @ userinfo',()=>{
 const {api}=load('ai-link-check.js',[]);
 let f=api.inspectUrl('https://login.rijksoverheid.nl.example/veilig-inloggen');
 assert.equal(f.hostname,'login.rijksoverheid.nl.example');assert.deepEqual([...f.embeddedDomainCandidates],['rijksoverheid.nl']);assert.equal(f.reservedExampleHost,true);
 f=api.inspectUrl('https://bank.example@konto-weryfikacja.example/login');
 assert.equal(f.hostname,'konto-weryfikacja.example');assert.equal(f.hasUserinfo,true);assert.equal(f.hostname.includes('@'),false);
 f=api.inspectUrl('https://www.rijksoverheid.nl/');assert.equal(f.embeddedDomainCandidates.length,0);assert.equal(f.hasUserinfo,false);
 assert.equal(api.inspectUrl('https://www.gov.uk/').embeddedDomainCandidates.length,0);
 assert.equal(api.inspectUrl('https://face.nl/').usesIpAddress,false);
 assert.equal(api.inspectUrl('https://127.0.0.1/').usesIpAddress,true);
});
test('link request explicitly prevents no-warning verdict for masked destination',async()=>{
 const h=load('ai-link-check.js',[{output_text:'Test result'}]);
 await h.api.handler({httpMethod:'POST',body:JSON.stringify({input:'https://bank.example@konto-weryfikacja.example/login'})},{});
 assert.match(h.calls[0].input,/NEVER say "no warning signs"/);assert.match(h.calls[0].input,/"hasUserinfo": true/);assert.equal(h.calls[0].store,false);
});
test('document audit replaces omitted/conflicting facts with reviewed result',async()=>{
 const candidate={detectedLang:'PL',analysis:'Kwota do zapłaty: 191,50 EUR.',translation:'',complete:true};
 const checked={...candidate,analysis:'150 + 31,50 = 181,50 EUR. Nagłówek 191,50 różni się o 10 EUR. Kwota wymaga wyjaśnienia; termin nieczytelny.'};
 const h=load('_document-analysis.js',[done(candidate),done(checked)]);
 const result=await h.api.analyze({key:'test',mode:'document_bill',text:'Netto 150, VAT 31,50, nagłówek 191,50, stopka 181,50.',userLang:'PL',sourceLang:'AUTO'});
 assert.equal(h.calls.length,2);assert.equal(result.analysis,checked.analysis);assert.equal(h.calls[1].store,false);
 assert.equal(JSON.parse(h.calls[1].input).originalDocument,'Netto 150, VAT 31,50, nagłówek 191,50, stopka 181,50.');
});
test('truncated document and missing translation fail instead of displaying success',async()=>{
 let h=load('_document-analysis.js',[{status:'incomplete',output_text:'{}'}]);
 await assert.rejects(()=>h.api.analyze({key:'test',mode:'document_pdf',text:'Invitation',userLang:'PL',sourceLang:'EN'}),/incomplete/);
 h=load('_document-analysis.js',[done({detectedLang:'EN',analysis:'Zaproszenie',translation:'',complete:true})]);
 await assert.rejects(()=>h.api.analyze({key:'test',mode:'document_pdf',text:'Invitation',userLang:'PL',sourceLang:'EN'}),/translation/);
});
test('simple numerical exercises also require independent review',()=>{
 const ex=require('../netlify/functions/_exercise');
 assert.equal(ex.needsReview('Een jas kost 80 euro, korting 25%, btw 21%.',{sourceLanguage:'NL',sourceAnswer:'x',complete:true},'PL'),true);
});
test('reviewed job result is displayed; candidate age/date require exact source evidence',async()=>{
 const candidate={sections:['work','wrong 600','requirements','questions','fit'],salary:{min:17.5,max:null,currency:'EUR',unit:'hour',basis:'gross',explicitGross:true,baseOnly:true,fullTime:true,quote:'€17,50 bruto per uur'},detected:{country:'NL',countryQuote:'Nederland',contract:'employee',contractQuote:'Arbeidsovereenkomst',age:30,ageQuote:'werknemer 30 jaar',startDate:'2026-11-01',dateQuote:'start 1 november 2026'}};
 const checked={...candidate,sections:['work','38 × 17,50 = 665 EUR brutto/tydzień','requirements','questions','fit']};
 const h=load('ai-job-offer.js',[done(candidate),done(checked)]);
 const text='Nederland. Arbeidsovereenkomst; werknemer 30 jaar; start 1 november 2026. €17,50 bruto per uur, 38 uur.';
 const result=JSON.parse((await h.api.handler({httpMethod:'POST',body:JSON.stringify({text,userLang:'PL'})},{})).body);
 assert.equal(result.ok,true);assert.equal(result.sections[1],checked.sections[1]);assert.equal(result.resolvedContext.age,30);assert.equal(result.resolvedContext.date,'2026-11-01');assert.equal(result.comparison.status,'ABOVE');
 assert.match(h.calls[1].instructions,/Independently review/);
 const unsupported={...checked,detected:{...checked.detected,ageQuote:'werknemer 99 jaar'}};
 const h2=load('ai-job-offer.js',[done(unsupported),done(unsupported)]);
 const result2=JSON.parse((await h2.api.handler({httpMethod:'POST',body:JSON.stringify({text,userLang:'PL'})},{})).body);
 assert.equal(result2.resolvedContext.age,undefined);assert.equal(result2.comparison.reason,'age');
});
test('AI text containing HTML is rendered as text, never innerHTML',()=>{
 const source=fs.readFileSync(path.join(root,'index.html'),'utf8');
 const a=source.indexOf('function sbAiPlainText('),b=source.indexOf('async function runAiToolsPreview()',a);
 const box={};const ctx={document:{getElementById:()=>box}};
 vm.runInNewContext(source.slice(a,b),ctx);
 ctx.sbAiSetResult('### Wynik\n**Uwaga** <img src=x onerror=alert(1)> sb-ai-result-cards');
 assert.equal(box.innerHTML,undefined);assert.equal(box.textContent,'Wynik\nUwaga <img src=x onerror=alert(1)> sb-ai-result-cards');
});
