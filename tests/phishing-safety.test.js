const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('fs'),vm=require('vm'),path=require('path');
const engine=require('../netlify/functions/_letter-analysis'),fixture=require('./letter-fixtures');
const dir=path.resolve(__dirname,'../netlify/functions');
function security(){
 const c={exports:{},process:{env:{}},URL,Intl,require:n=>n==='./_usage'?{}:require(n.startsWith('.')?path.join(dir,n):n)};
 vm.runInNewContext(fs.readFileSync(path.join(dir,'analyze.js'),'utf8'),c);return c;
}
const source=`Belastingdienst — Nederland
Onderwerp: Laatste waarschuwing: uw belastingteruggave wordt geblokkeerd
Geachte heer/mevrouw,
U heeft recht op een belastingteruggave van € 286,40. Vanwege een veiligheidscontrole moet u uw identiteit binnen 2 uur bevestigen. Zonder bevestiging wordt uw teruggave geannuleerd en uw account geblokkeerd.
Open onmiddellijk:
https://belastingdienst.nl.veilige-controle.example/teruggave
Vul daar uw DigiD-gebruikersnaam, wachtwoord en de ontvangen sms-code in. Betaal vervolgens € 1,95 om uw bankrekening te controleren.
Werkt de eerste link niet? Gebruik dan:
https://digid-bevestigen.example/belastingdienst
Bel niet met de Belastingdienst. Telefonische medewerkers kunnen deze controle niet uitvoeren. Reageer ook niet via uw gewone DigiD-omgeving, omdat uw dossier daar tijdelijk niet zichtbaar is.
Met vriendelijke groet,
Afdeling Digitale Veiligheid
Belastingdienst`;
function maliciousReview(level='HIGH'){
 const d=fixture.draft();Object.assign(d,{detectedLang:'NL',translation:source,facts:[],calculations:[],summary:'Przysługuje Ci 286,40 €. Potwierdź dane w ciągu 2 godzin.',actions:[{text:'Natychmiast otwórz link https://belastingdienst.nl.veilige-controle.example/teruggave',quotes:['Open onmiddellijk:']},{text:'Nie dzwoń do Belastingdienst.',quotes:['Bel niet met de Belastingdienst.']}],consequences:[{text:'Brak potwierdzenia spowoduje zablokowanie konta.',quotes:['Zonder bevestiging wordt uw teruggave geannuleerd en uw account geblokkeerd.']}],institution:{name:'',country:'',officialWebsite:'',confidence:0,quote:''},urgency:'HIGH',responseRequired:'YES',replyGuidance:'Nie odpowiadaj podejrzanemu nadawcy.',help:['Otwórz https://digid-bevestigen.example/belastingdienst'],risks:[],detectedLinks:source.match(/https?:\/\/\S+/g)});
 d.fraudRisk.level=level;d.fraudRisk.findings=[{kind:'SECRET_DISCLOSURE',quote:'Vul daar uw DigiD-gebruikersnaam, wachtwoord en de ontvangen sms-code in.',polarity:'AFFIRMATIVE',severity:'HIGH',explanation:'Żądanie danych DigiD i kodu SMS na stronie podszywającej się pod urząd.'}];return d;
}
for(const level of ['HIGH','LOW'])test(`phishing ${level} cannot turn sender instructions into advice and restores the official Dutch site`,async()=>{
 const c=security(),d=maliciousReview(level),values=[d,fixture.review(d)];
 const out=await engine.analyze({key:'test',text:source,userLang:'PL',sourceLang:'NL',fetcher:async()=>fixture.api(values.shift()),recordUsage:async()=>{},applySecurity:(v,stage,language)=>c.applyLetterSecurity(v,source,'PL',stage,language)});
 assert.equal(out.fraudRisk.level,'HIGH');assert.equal(out.institution.name,'Belastingdienst');assert.equal(out.institution.country,'NL');assert.equal(out.institution.officialWebsite,'https://www.belastingdienst.nl');
 assert.deepEqual(out.helpLinks,[{label:'Belastingdienst',url:'https://www.belastingdienst.nl'}]);
 for(const key of ['summary','whatOfficeSays','communication','officeSummary','actions','nextSteps','help','risks','riskList','riskChips','consequences'])assert.doesNotMatch(JSON.stringify(out[key]),/\.example|Natychmiast otwórz|Nie dzwoń|Brak potwierdzenia spowoduje/,key);
 assert.match(out.actions.join(' '),/Nie klikaj/);assert.match(out.actions.join(' '),/https:\/\/www\.belastingdienst\.nl/);
 assert.deepEqual(out.consequences,[]);assert.equal(out.urgency,'UNKNOWN');assert.equal(out.responseRequired,'NO');assert.equal(out.replyIntent,'NO_REPLY');assert.ok(Object.values(out.replies).every(x=>x===''));
 assert.equal(out.translation,source);assert.deepEqual(out.evidence.actions,[]);assert.equal(out.safetyMode,'VERIFY_OFFICIAL');
});
test('a body mention or imitation domain cannot supply an official sender identity',()=>{
 const c=security();assert.equal(c.sbLetterHeaderInstitution('Elisabeth says this is not from Belastingdienst.\nhttps://belastingdienst.nl.evil.example'),null);
 const v=maliciousReview();v.institution={name:'Unknown Office',country:'',officialWebsite:'https://evil.example',confidence:95,quote:'Unknown Office'};
 c.applyLetterSecurity(v,'Unknown Office\nEnter password and SMS code at https://evil.example','PL','final','EN');
 assert.equal(v.institution.officialWebsite,'');assert.equal(v.verifiedInstitution,false);
});
test('sender header survives plain-text line wrapping without mistaking the DigiD credential request for the sender',()=>{
 const c=security();assert.equal(c.sbLetterHeaderInstitution(source.replace(/\n/g,' ')).entry.name,'Belastingdienst');
});


test('Czech tax authority headers and aliases restore the independently registered website',()=>{
 const c=security();
 for(const header of ['Finanční správa České republiky','Finanční správa','Finanční správa ČR','Financni sprava']){
  for(const separator of ['\n',' ']){
   const text=header+separator+'Předmět: Vrácení daně\nZadejte heslo a kód SMS na https://financnisprava.gov.cz.overeni-uctu.example/preplatek';
   const v=fixture.review();v.fraudRisk.level='HIGH';v.institution={name:'',country:'',officialWebsite:'',confidence:0,quote:''};
   c.applyLetterSecurity(v,text,'PL','final','CS');const out=engine.project(v,text,'CS','PL','CS');
   assert.equal(out.institution.name,'Finanční správa',header);assert.equal(out.institution.country,'CZ');assert.equal(out.institution.officialWebsite,'https://financnisprava.gov.cz');
   assert.deepEqual(out.helpLinks,[{label:'Finanční správa',url:'https://financnisprava.gov.cz'}]);assert.match(out.actions.join(' '),/https:\/\/financnisprava\.gov\.cz/);assert.doesNotMatch(out.actions.join(' '),/\.example/);
  }
 }
});
test('similar Czech words and a body mention do not create a tax-authority identity',()=>{
 const c=security();
 for(const text of ['Finanční služby ABC\nPředmět: nabídka', 'Dobrý den, toto není zpráva od Finanční správy.'])assert.equal(c.sbLetterHeaderInstitution(text),null);
});

test('Humanitas patient portal does not trigger impersonation but lookalikes still do',()=>{
 const c=security();
 const institution={name:'Humanitas Research Hospital',country:'IT',officialWebsite:'https://www.humanitas.it/',confidence:95};
 const text='Conferma visita cardiologica 12 novembre 2026 ore 10:30. Accedere con le credenziali personali. Non invii password o codici di accesso. ';
 for(const host of ['humanitasconte.it','www.humanitasconte.it']){
  const link='https://'+host+'/';
  assert.equal(c.sbDetectStrongPhishingV8(text+link,[link],institution).hardHigh,false);
  assert.equal(c.sbDetectInstitutionImpersonationPatchV1(text+link,[link],institution).minimumMedium,false);
  const ctx={text:text+link,institution,detectedLinks:[link],fraudRisk:{level:'LOW'},userLang:'PL'};
  c.sbApplyGlobalImpersonationHighGuardV1(ctx);assert.equal(ctx.fraudRisk.level,'LOW');
 }
 for(const host of ['humanitasconte.it.evil.example','evilhumanitasconte.it','humanitas-conte.example']){
  const link='https://'+host+'/login';
  assert.equal(c.sbHostMatchesInstitution(host,'humanitas.it',institution),false);
  const ctx={text:'Enter password immediately '+link,institution,detectedLinks:[link],fraudRisk:{level:'LOW'},userLang:'PL'};
  c.sbApplyGlobalImpersonationHighGuardV1(ctx);assert.equal(ctx.fraudRisk.level,'HIGH');
 }
 assert.equal(c.sbHostMatchesInstitution('humanitasconte.it','unrelated-hospital.it',institution),false);
 const risky={text:'Send password and SMS code immediately https://www.humanitasconte.it/',institution,detectedLinks:['https://www.humanitasconte.it/'],fraudRisk:{level:'HIGH'},userLang:'PL'};
 c.sbApplyGlobalImpersonationHighGuardV1(risky);assert.equal(risky.fraudRisk.level,'HIGH');
});

test('only server supplied portal evidence suppresses domain mismatch for the same institution',()=>{
 const c=security(),link='https://patient.gov.it/';
 const make=()=>({institution:{name:'Hospital ABC',quote:'Hospital ABC',officialWebsite:'https://hospital.gov.it/',confidence:95,relatedOfficialHosts:['patient.gov.it']},detectedLinks:[link],suspiciousLinks:[],fraudRisk:{level:'LOW',confidence:60,signals:[],suspiciousElements:[],safeSteps:[]},risks:[],consequences:[],help:[]});
 const text='Hospital ABC\nAccedere con le credenziali. Non invii password. '+link;
 const untrusted=make();c.applyLetterSecurity(untrusted,text,'PL','final','IT');assert.equal(untrusted.fraudRisk.level,'LOW');assert.equal(untrusted.institution.officialWebsite,'');
 const trusted=make();c.applyLetterSecurity(trusted,text,'PL','final','IT',[{host:'patient.gov.it',officialHost:'hospital.gov.it',institutionName:'Hospital ABC',verification:'official-link'}]);assert.equal(trusted.fraudRisk.level,'LOW');
});
test('a specific hospital is not replaced with an umbrella NHS identity',()=>{
 const c=security();assert.equal(c.sbSameInstitutionNameV2('Great Western Hospitals NHS Foundation Trust','NHS'),false);
 const v={institution:{name:'Great Western Hospitals NHS Foundation Trust',quote:'Great Western Hospitals NHS Foundation Trust',officialWebsite:'https://www.gwh.nhs.uk/',country:'GB',confidence:95},fraudRisk:{level:'LOW',confidence:60,signals:[],suspiciousElements:[],safeSteps:[]},detectedLinks:['https://my.drdoctor.co.uk/'],risks:[],consequences:[],help:[]};
 c.applyLetterSecurity(v,'Great Western Hospitals NHS Foundation Trust\nUnited Kingdom\nLog in on https://my.drdoctor.co.uk/','PL','final','EN',[{host:'my.drdoctor.co.uk',officialHost:'gwh.nhs.uk',institutionName:v.institution.name,verification:'official-link'}]);
 assert.equal(v.institution.name,'Great Western Hospitals NHS Foundation Trust');assert.equal(v.fraudRisk.level,'LOW');
});
