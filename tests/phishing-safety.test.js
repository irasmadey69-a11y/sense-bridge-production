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
 d.fraudRisk.level=level;return d;
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
