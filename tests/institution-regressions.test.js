const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const engine=require('../netlify/functions/_letter-analysis'),fixture=require('./letter-fixtures');
const {countrySupported}=require('../netlify/functions/_institution-country');
const root=path.resolve(__dirname,'..'),dir=path.join(root,'netlify/functions');
const html=fs.readFileSync(path.join(root,'index.html'),'utf8');
function security(){
 const context={exports:{},process:{env:{}},URL,Intl,require:name=>name==='./_usage'?{}:require(name.startsWith('.')?path.join(dir,name):name)};
 vm.runInNewContext(fs.readFileSync(path.join(dir,'analyze.js'),'utf8'),context);return context;
}
const examples=[
 {label:'Russian phishing, Russian tax service, no official link',source:'Федеральная налоговая служба (ФНС России)\nРоссийская Федерация\nТема: Возврат налога\nВведите пароль и код SMS: https://fns-vozvrat.example/verification',language:'RU',country:'RU',host:'www.nalog.gov.ru'},
 {label:'Dutch phishing, Russian tax service, no official link',source:'Федеральная налоговая служба (ФНС России)\nRusland\nOnderwerp: Belastingteruggave\nVoer uw wachtwoord en sms-code in: https://fns-vozvrat.example/verification',language:'NL',country:'RU',host:'www.nalog.gov.ru'},
 {label:'Russian informational tax letter without a URL',source:'Федеральная налоговая служба (ФНС России)\nМосква, Российская Федерация\nТема: Информация\nПисьмо не требует ответа или оплаты.',language:'RU',country:'RU',host:'www.nalog.gov.ru'},
 {label:'Russian informational tax letter with a URL',source:'Федеральная налоговая служба (ФНС России)\nРоссийская Федерация\nТема: Информация\nОфициальный сайт: https://www.nalog.gov.ru/\nПисьмо не требует ответа.',language:'RU',country:'RU',host:'www.nalog.gov.ru'},
 {label:'Russian impersonation of the Dutch tax service',source:'Отправитель: Belastingdienst — Налоговая служба Нидерландов\nТема: Возврат налога\nВведите пароль DigiD и код SMS: https://belastingdienst-teruggave.example/refund\nBelastingdienst, Nederland',language:'RU',country:'NL',host:'www.belastingdienst.nl'},
 {label:'Dutch tax service mentioned alongside a Russian address',source:'Belastingdienst\nOnderwerp: Informatie\nAdres van de ontvanger: Москва, Российская Федерация',language:'NL',country:'NL',host:'www.belastingdienst.nl'},
 {label:'English tax service with a recipient in the Netherlands',source:'Internal Revenue Service\nUnited States\nSubject: Information\nRecipient location: Nederland',language:'EN',country:'US',host:'www.irs.gov'}
];
for(const example of examples)test(example.label,()=>{
 const candidate=fixture.review();candidate.institution={name:'',country:'',officialWebsite:'',quote:'',confidence:0};
 security().applyLetterSecurity(candidate,example.source,'PL','final',example.language);
 const result=engine.project(candidate,example.source,example.language,'PL','AUTO');
 assert.equal(result.institution.country,example.country);assert.equal(new URL(result.institution.officialWebsite).hostname,example.host);
 assert.equal(result.institution.verification,'registry');assert.ok(result.helpLinks.length);assert.doesNotMatch(result.institution.officialWebsite,/\.example/);
});
test('country evidence supports all catalog locales and excludes embedded URL fragments',()=>{
 assert.equal(countrySupported('RU','Российская Федерация'),true);
 assert.equal(countrySupported('RU','Rusland'),true);
 assert.equal(countrySupported('NL','Нидерланды'),true);
 assert.equal(countrySupported('US','https://www.nalog.gov.ru/'),false);
 assert.equal(countrySupported('NL','Dit is een bericht in het Nederlands.'),false);
});
test('HIGH keeps specific meaning, amount and communication risks while replacing unsafe next steps',()=>{
 const candidate=fixture.review();candidate.summary='Nadawca obiecuje zwrot 18 450 rubli i żąda hasła w ciągu 24 godzin.';
 candidate.risks=['Nadawca żąda hasła i kodu SMS.','Nadawca zabrania kontaktu z urzędem.'];candidate.fraudRisk.level='HIGH';
 const result=engine.project(candidate,'source','RU','PL','AUTO');
 assert.equal(result.summary,candidate.summary);assert.equal(result.whatOfficeSays,candidate.summary);assert.deepEqual(result.risks,candidate.risks);
 assert.match(result.actions[0],/Nie klikaj/);assert.equal(result.replyIntent,'NO_REPLY');assert.deepEqual(result.consequences,[]);
});
test('frontend does not replace verified institution country with recipient country or link fragments',()=>{
 let rendered='';
 const context={URL,sbGetResultLang:()=> 'PL',sbTrustedInstitutionInfo:()=>null,renderInstitutionSearch(){},document:{getElementById:()=>({set innerHTML(value){rendered=value;}})},escapeHtml:String,sbResultText:x=>x,sbTrustText:x=>x,sbInstitutionVerifyText:x=>x,countryName:code=>code};
 const source=html.slice(html.indexOf('function renderInstitution(data){'),html.indexOf('\nfunction countryName(',html.indexOf('function renderInstitution(data){')));
 vm.runInNewContext(source,context);
 context.renderInstitution({institution:{name:'ФНС России',country:'RU',officialWebsite:'https://www.nalog.gov.ru/',verification:'web'}});
 assert.match(rendered,/RU/);assert.doesNotMatch(rendered,/Holandia|countryFromDocument/);assert.match(rendered,/nalog.gov.ru/);
});
test('quick meaning is short without losing the full result',()=>{
 const source=html.slice(html.indexOf('function sbNormalizeQuickText('),html.indexOf('function sbExtractDocumentUrls('));
 const context={};vm.runInNewContext(source,context);
 const data={summary:'Pismo informuje o możliwości sprawdzenia powiadomień podatkowych. '+ 'Dodatkowe szczegóły dokumentu. '.repeat(30)};
 const original=data.summary,short=context.sbBuildQuickMeaning(data);
 assert.ok(short.length<=240);assert.match(short,/powiadomień podatkowych/);assert.equal(data.summary,original);
});
test('rendered analysis scrolls to the start after both layout frames, including a tall quick card',()=>{
 const a=html.indexOf('    const quickBox = document.getElementById("sbQuickResult");',html.indexOf('async function analyze('));
 const source=html.slice(a,html.indexOf('  } catch (e){',a));const queue=[],calls=[];
 const card={scrollIntoView:options=>calls.push(options)},context={document:{getElementById:()=>card},requestAnimationFrame:callback=>queue.push(callback)};
 vm.runInNewContext(source,context);assert.equal(calls.length,0);queue.shift()();assert.equal(calls.length,0);queue.shift()();
 assert.equal(calls.length,1);assert.equal(calls[0].block,'start');assert.equal(calls[0].behavior,'instant');
});
test('informational letters do not promote optional actions to the quick required-action card',()=>{
 const elements=new Map(),element=id=>{if(!elements.has(id))elements.set(id,{textContent:'',className:'',style:{},classList:{add(){}}});return elements.get(id);};
 const context={document:{getElementById:element},sbGetResultLang:()=> 'PL',sbApplyUxV10Texts(){},sbBuildQuickMeaning:data=>data.summary,sbUx10Text:key=>key,sbShortenText:String,sbFirstUsefulText:list=>list[0],sbFraudLevelFromData:data=>data.fraudRisk.level,sbPillClass:x=>x};
 const source=html.slice(html.indexOf('function sbRenderQuickResultCards(data){'),html.indexOf('function sbClearQuickResultCards(){'));
 vm.runInNewContext(source,context);
 context.sbRenderQuickResultCards({summary:'Pismo informacyjne.',responseRequired:'NO',replyIntent:'NO_REPLY',replyGuidance:'Nie musisz odpowiadać ani płacić.',actions:['Sprawdź konto podatkowe.'],fraudRisk:{level:'LOW'}});
 assert.equal(element('sbQuickActionText').textContent,'Nie musisz odpowiadać ani płacić.');
 context.sbRenderQuickResultCards({summary:'Nadawca żąda hasła.',responseRequired:'NO',replyIntent:'NO_REPLY',replyGuidance:'Nie odpowiadaj.',actions:['Nie klikaj linku.'],fraudRisk:{level:'HIGH'}});
 assert.equal(element('sbQuickActionText').textContent,'Nie klikaj linku.');
});
test('an unresolved web lookup distinguishes a recorded official address from failed live confirmation',()=>{
 function element(){return {children:[],style:{},textContent:'',replaceChildren(){this.children=[];},appendChild(child){this.children.push(child);}};}
 const box=element(),context={URL,document:{getElementById:()=>box,createElement:element},sbGetResultLang:()=> 'PL',sbTrustedInstitutionInfo:()=>({country:'RU'}),countryName:x=>x};
 const source=html.slice(html.indexOf('function renderInstitutionSearch(data){'),html.indexOf('function renderInstitution(data){'));
 vm.runInNewContext(source,context);
 context.renderInstitutionSearch({institution:{name:'ФНС России',officialWebsite:'https://www.nalog.gov.ru/',verification:'registry'},institutionSearch:{status:'unverified',institutions:[],unresolved:['ФНС России']}});
 const text=box.children.map(x=>x.textContent).join(' ');
 assert.match(text,/Zapisany oficjalny adres/);assert.match(text,/dodatkowego potwierdzenia/);assert.doesNotMatch(text,/Nie udało się jednoznacznie potwierdzić wszystkich/);
});
