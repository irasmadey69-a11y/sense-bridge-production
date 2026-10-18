const {test}=require('node:test'),assert=require('node:assert/strict');
const engine=require('../netlify/functions/_letter-analysis');
const fixture=require('./letter-fixtures');
function harness(values,options={}){
 const requests=[],usage=[];
 const run=()=>engine.analyze({key:'test-only',text:fixture.source,userLang:'PL',sourceLang:'AUTO',recordUsage:async(_e,_c,data,meta)=>{usage.push({data,meta});},fetcher:async(_url,opts)=>{requests.push(JSON.parse(opts.body));assert.ok(values.length,'Unexpected extra model request');const value=values.shift();return typeof value==='function'?value(opts):fixture.api(value);},...options});
 return {run,requests,usage};
}
test('letter preserves reviewed facts, conditional action and full translation with exactly two model calls',async()=>{
 const d=fixture.draft(),r=fixture.review();d.summary='Pozostało 100 EUR.';
 const h=harness([d,r]);const output=await h.run();
 assert.equal(output.ok,true);assert.equal(output.pipeline,engine.PIPELINE);assert.equal(h.requests.length,2);
 assert.match(output.summary,/60 EUR/);assert.match(output.actions[0],/Jeśli.*przed 20 listopada/);assert.deepEqual(output.consequences,[]);assert.equal(output.translation,fixture.source);
 for(const req of h.requests){assert.equal(req.store,false);assert.equal(req.text.format.type,'json_schema');assert.equal(req.text.format.strict,true);}
 assert.deepEqual(h.usage.map(x=>x.meta.feature),['LETTER_DRAFT','LETTER_ANALYSIS']);
 assert.ok(h.usage.every(x=>!JSON.stringify(x.meta).includes('Kopię dokumentu')));
});
test('review repairs unsupported draft evidence instead of displaying it',async()=>{
 const d=fixture.draft();d.consequences=[{text:'Utracisz prawo.',quotes:['Invented source quote']}];
 const h=harness([d,fixture.review()]);const r=await h.run();assert.deepEqual(r.consequences,[]);assert.match(h.requests[1].input[1].content,/LETTER_UNVERIFIED/);
});
test('unsupported consequence in final review is rejected, never returned as success',async()=>{
 const r=fixture.review();r.consequences=[{text:'Utrata świadczenia.',quotes:['Nieistniejąca sankcja']}];
 await assert.rejects(harness([fixture.draft(),r]).run(),e=>e.code==='LETTER_UNVERIFIED');
});
test('review must preserve complete monetary translation or supply a correction',async()=>{
 const d=fixture.draft();d.detectedLang='NL';d.translation='Kwota 100 EUR, wpłacono 40 EUR.';
 const r=fixture.review();r.translationCorrection=fixture.source;
 const ok=await harness([d,r]).run();assert.match(ok.translation,/60 EUR/);
 r.translationCorrection='';await assert.rejects(harness([d,r]).run(),e=>e.code==='LETTER_UNVERIFIED');
});
test('partial, malformed, refused and HTML upstream responses never become usable analyses',async()=>{
 for(const response of [fixture.api(fixture.draft(),{status:'incomplete'}),fixture.api(fixture.draft(),{output_text:'{bad'}),{ok:false,status:502,text:async()=>'<HTML>Gateway error</HTML>'},fixture.api(fixture.draft(),{output_text:'',output:[{content:[{type:'refusal',refusal:'No'}]}]})]){
  await assert.rejects(harness([()=>response]).run(),e=>e.code?.startsWith('LETTER_'));
 }
});
test('strict runtime validation catches missing fields and wrong types even if model output parses as JSON',()=>{
 const d=fixture.draft();delete d.actions;assert.throws(()=>engine.validateShape(d,engine.draftSchema),e=>e.code==='LETTER_INCOMPLETE');
 const r=fixture.review();r.fraudRisk.confidence='95';assert.throws(()=>engine.validateShape(r,engine.reviewSchema));
});
test('global deadline covers stuck fetch and stuck response body',async()=>{
 for(const fetcher of [()=>new Promise(()=>{}),async()=>({ok:true,status:200,text:()=>new Promise(()=>{})})]){
  const start=Date.now();await assert.rejects(engine.analyze({key:'test',text:fixture.source,userLang:'PL',sourceLang:'AUTO',fetcher,timeoutMs:100,recordUsage:async()=>{}}),e=>e.code==='LETTER_TIMEOUT');
  assert.ok(Date.now()-start<1500);
 }
});
test('no third request is made after a deadline even when a late fetch ignores cancellation',async()=>{
 let calls=0;const fetcher=async()=>{calls++;await new Promise(r=>setTimeout(r,150));return fixture.api(fixture.draft());};
 await assert.rejects(engine.analyze({key:'test',text:fixture.source,userLang:'PL',sourceLang:'AUTO',fetcher,timeoutMs:100,recordUsage:async()=>{}}));
 await new Promise(r=>setTimeout(r,100));assert.equal(calls,1);
});
test('high-risk credential theft never offers a reply to the suspicious sender',async()=>{
 const source='Send your password and SMS code to https://tax.gov.account-verify.example/login';
 const d=fixture.draft();d.detectedLang='EN';d.translation=source;d.facts=[];d.actions=[];d.summary='Wiadomość prosi o hasło i kod SMS.';d.fraudRisk.level='HIGH';d.detectedLinks=['https://tax.gov.account-verify.example/login'];d.replyIntent='NO_REPLY';d.replyGuidance='Nie odpowiadaj podejrzanemu nadawcy.';
 const r=fixture.review(d);const output=await harness([d,r],{text:source}).run();
 assert.equal(output.fraudRisk.level,'HIGH');assert.equal(output.replyIntent,'NO_REPLY');assert.deepEqual(output.replies,{neutral:'',polite:'',firm:''});assert.equal(output.repliesDocument.neutral,'');
});
test('obvious credential theft cannot pass a low-risk review',async()=>{
 const source='Enter password and SMS code at https://bad.example/login';const d=fixture.draft();d.translation=source;d.detectedLang='EN';d.facts=[];d.actions=[];d.summary='Wiadomość prosi o hasło i kod SMS.';
 await assert.rejects(harness([d,fixture.review(d)],{text:source}).run(),e=>e.code==='LETTER_UNVERIFIED');
});
test('recipient commitments and adviser perspective are rejected across common languages',()=>{
 for(const s of ['Potwierdzam swoją obecność.','Proszę o potwierdzenie mojej obecności.','Chętnie dostarczę dokumenty.','W razie potrzeby służę pomocą.','I will pay tomorrow.','Please confirm my attendance.','Ich bestätige meine Teilnahme.','Je confirme ma présence.','Ik zal betalen.'])assert.equal(engine.replyViolatesIntent(s),true,s);
 for(const s of ['Potwierdzam otrzymanie wiadomości.','Proszę o doprecyzowanie danych nadawcy.','Thank you for your letter.'])assert.equal(engine.replyViolatesIntent(s),false,s);
});
test('unsafe reply is withheld without discarding the verified letter analysis',async()=>{
 const r=fixture.review();r.replies.polite='Potwierdzam swoją obecność.';
 const out=await harness([fixture.draft(),r]).run();assert.equal(out.ok,true);assert.match(out.summary,/60 EUR/);assert.equal(out.replyIntent,'MANUAL_REPLY');assert.equal(out.responseRequired,r.responseRequired);
 for(const replies of [out.replies,out.repliesDocument])assert.ok(Object.values(replies).every(v=>v===''));
 assert.match(out.replyGuidance,/nie składać zobowiązań/);assert.equal(out.qualityChecked,true);
});
test('false institution evidence and invented URLs are not exposed',()=>{
 const d=fixture.draft();d.institution={name:'IND',country:'NL',officialWebsite:'https://ind.nl',confidence:99,quote:'indépendant'};
 engine.validateEvidence(d,fixture.source);assert.equal(d.institution.name,'');assert.equal(d.institution.country,'');
 d.detectedLinks=['https://invented.example'];assert.throws(()=>engine.validateEvidence(d,fixture.source),e=>e.code==='LETTER_UNVERIFIED');
});
test('output region is conveyed as language choice, not document-country evidence',async()=>{
 const h=harness([fixture.draft(),fixture.review()],{outputRegion:'PL'});await h.run();assert.match(h.requests[0].input[0].content,/not evidence of the document country/);
});
test('overlong or empty source is rejected before making API calls',async()=>{
 for(const text of ['', 'a'.repeat(24001)]){const h=harness([],{text});await assert.rejects(h.run());assert.equal(h.requests.length,0);}
});
test('a security floor seen in the draft cannot be silently lowered by the review',async()=>{
 const d=fixture.draft(),r=fixture.review();d.fraudRisk.level='HIGH';d.replyGuidance='Nie odpowiadaj nadawcy.';r.replyGuidance=d.replyGuidance;
 const output=await harness([d,r]).run();assert.equal(output.fraudRisk.level,'HIGH');assert.equal(output.replyIntent,'NO_REPLY');assert.equal(output.replies.neutral,'');
});
test('telemetry failure cannot turn a verified analysis into a failed request',async()=>{
 const h=harness([fixture.draft(),fixture.review()],{recordUsage:async()=>{throw Error('stats down')}});assert.equal((await h.run()).ok,true);
});
test('institution recognition uses sender evidence, not an incidental name elsewhere in the letter',()=>{
 const fs=require('fs'),vm=require('vm'),path=require('path'),dir=path.resolve(__dirname,'../netlify/functions');
 const c={exports:{},process:{env:{}},URL,require:n=>n==='./_usage'?{}:require(n.startsWith('.')?path.join(dir,n):n)};
 vm.runInNewContext(fs.readFileSync(path.join(dir,'analyze.js'),'utf8'),c);
 const unrelated=fixture.draft();c.applyLetterSecurity(unrelated,'Elisabeth says this is not from IND or Belastingdienst.','PL','draft');assert.equal(unrelated.institution.name,'');
 const named=fixture.draft();named.institution={name:'Belastingdienst',country:'',officialWebsite:'',confidence:80,quote:'Belastingdienst'};
 c.applyLetterSecurity(named,'Belastingdienst: informatieve brief.','PL','draft');assert.equal(named.institution.country,'NL');assert.match(named.institution.officialWebsite,/belastingdienst\.nl/);
 const bad=fixture.draft();bad.institution={name:'IND',country:'NL',officialWebsite:'https://ind.nl',confidence:95,quote:'indépendant'};
 c.applyLetterSecurity(bad,'Vous êtes indépendant.','PL','draft');assert.equal(bad.institution.name,'');
});
test('a warning not to share credentials is not treated as a request to send them',()=>{
 for(const source of ['Never enter your password and SMS code at https://bank.example.','Do not share your password or SMS code at https://bank.example.','Nie podaj hasła ani kodu SMS na https://bank.example.'])assert.equal(engine.hardCredentialRequest(source),false,source);
 assert.equal(engine.hardCredentialRequest('Enter your password and SMS code at https://bad.example.'),true);
});
test('reviewed critical deadlines cannot disappear from summary and actions',async()=>{
 const r=fixture.review();r.facts.push({kind:'DEADLINE',quote:'Kopię dokumentu dostarcz przed 20 listopada 2026, jeśli jesteś zatrudniony.',explanation:'Termin: przed 20 listopada 2026.',status:'CURRENT'});
 r.summary='Prośba o dokumenty.';r.actions=[];
 await assert.rejects(harness([fixture.draft(),r]).run(),e=>e.code==='LETTER_UNVERIFIED');
});
test('new numeric dates or amounts absent from the source are rejected',async()=>{
 const r=fixture.review();r.summary+=' Zapłać 900 EUR.';
 await assert.rejects(harness([fixture.draft(),r]).run(),e=>e.code==='LETTER_UNVERIFIED');
});
test('derived balance is allowed only when source operands and arithmetic are verified',async()=>{
 const source='Kwota 100 EUR. Wpłacono 40 EUR.';const d=fixture.draft();d.translation=source;d.facts=[];d.actions=[];d.summary='Pozostało 60 EUR.';
 d.calculations=[{operation:'SUBTRACT',operands:[100,40],result:60,quotes:['Kwota 100 EUR. Wpłacono 40 EUR.']}];
 const r=fixture.review(d);const output=await harness([d,r],{text:source}).run();assert.match(output.summary,/60 EUR/);
 r.calculations[0].result=70;await assert.rejects(harness([d,r],{text:source}).run(),e=>e.code==='LETTER_UNVERIFIED');
});
test('decimal amount formats and explicit arithmetic keep numeric value',()=>{
 assert.equal(engine.translationTokensPresent('17,50 EUR','17.50 EUR'),true);
 const result={summary:'Pozostało 7,5 EUR.',actions:[],facts:[],calculations:[{operation:'SUBTRACT',operands:[17.5,10],result:7.5,quotes:['17,50 EUR, zapłacono 10 EUR.']}]};
 engine.validateCriticalFacts(result,'17,50 EUR, zapłacono 10 EUR.');
});
test('German dotted dates and Dutch dotted times are not mistaken for invented monetary numbers',()=>{
 const result={summary:'Wizyta 19 listopada 2026 o 11:30.',actions:[],facts:[],calculations:[]};
 engine.validateCriticalFacts(result,'Termin 19.11.2026, 11.30 uur.');
});

test('fractional model confidence is normalized to percentage points and existing percentages stay unchanged',async()=>{
 const d=fixture.draft(),r=fixture.review();d.fraudRisk.confidence=0.9;r.fraudRisk.confidence=0.9;
 const output=await harness([d,r]).run();assert.equal(output.fraudRisk.confidence,90);
 const other=fixture.review();other.fraudRisk.confidence=75;
 assert.equal((await harness([fixture.draft(),other]).run()).fraudRisk.confidence,75);
});
test('both model passes explicitly keep phishing threats attributed and confidence uses a percentage scale',async()=>{
 const h=harness([fixture.draft(),fixture.review()]);await h.run();
 for(const req of h.requests){assert.match(req.input[0].content,/EVERY threat or claimed consequence/);assert.match(req.input[0].content,/90, not 0.9/);}
 assert.match(h.requests[1].input[1].content,/unverified claims, not established outcomes/);
});

test('unsafe document-language reply is also withheld; invalid source evidence still fails',async()=>{
 const r=fixture.review();r.repliesDocument.firm='I will pay tomorrow.';
 const out=await harness([fixture.draft(),r]).run();assert.equal(out.replyIntent,'MANUAL_REPLY');assert.equal(out.replies.neutral,'');
 r.actions[0].quotes=['Invented quote'];await assert.rejects(harness([fixture.draft(),r]).run(),e=>e.code==='LETTER_UNVERIFIED');
});

test('French grouped amounts preserve their whole value across translation and arithmetic',()=>{
 for(const space of [' ','\u00a0','\u202f']){
  assert.equal(engine.translationTokensPresent(`24${space}600 € et 28${space}950 €`,'24600 EUR i 28950 EUR'),true);
  assert.equal(engine.translationTokensPresent(`24${space}600 €`,'24900 EUR'),false);
  engine.validateCriticalFacts({summary:'Różnica: 4350 EUR.',actions:[],facts:[],calculations:[{operation:'SUBTRACT',operands:[28950,24600],result:4350,quotes:[`28${space}950 € et 24${space}600 €`]}]},`28${space}950 € et 24${space}600 €`);
 }
});
test('separate requests preserve full review and reject tampered source evidence',async()=>{
 const full=fixture.draft();const prepared=Object.fromEntries(Object.keys(engine.preparationSchema.properties).map(k=>[k,full[k]]));
 const draft=await harness([prepared],{stage:'draft'}).run();
 assert.equal(draft.stage,'draft');assert.equal(draft.qualityChecked,undefined);
 const final=await harness([fixture.review()],{stage:'review',draft:draft.draft}).run();
 assert.equal(final.qualityChecked,true);
 const bad=fixture.review();bad.actions[0].quotes=['Forged evidence'];
 await assert.rejects(harness([bad],{stage:'review',draft:draft.draft}).run(),e=>e.code==='LETTER_UNVERIFIED');
 await assert.rejects(harness([],{stage:'review',draft:{}}).run(),e=>e.code==='LETTER_INCOMPLETE');
});

test('typographic apostrophes and list markers do not change source evidence, but words and amounts do',()=>{
 assert.equal(engine.sourceContains('Montants :\n— 630 € sans majoration ;\n— 691,20 € avec majoration.', 'Montants : 630 € sans majoration ; 691,20 € avec majoration.'),true);
 assert.equal(engine.sourceContains('l’impôt', "l'impôt"),true);
 assert.equal(engine.sourceContains('Ne payez pas 630 €.', 'Payez 630 €.'),false);
 assert.equal(engine.sourceContains('Montant 630 €.', 'Montant 690 €.'),false);
});

test('French tax amounts and official information links do not impersonate credentials or card brands',()=>{
 const fs=require('fs'),vm=require('vm'),path=require('path'),dir=path.resolve(__dirname,'../netlify/functions');
 const c={exports:{},process:{env:{}},URL,Intl,require:n=>n==='./_usage'?{}:require(n.startsWith('.')?path.join(dir,n):n)};
 vm.runInNewContext(fs.readFileSync(path.join(dir,'analyze.js'),'utf8'),c);
 const institution={name:'Impots.gouv.fr',country:'FR',officialWebsite:'https://www.impots.gouv.fr',confidence:95};
 const links=['https://www.impots.gouv.fr/particulier','https://www.service-public.gouv.fr/particuliers/vosdroits/N247'];
 const text='Montant envisagé : 630 €. Régularisation envisagée. '+links.join(' ');
 const signals=c.sbDetectStrongPhishingV8(text,links,institution);
 assert.equal(signals.credential,false);assert.equal(signals.financialBrand,false);assert.equal(signals.suspiciousLink,false);
 assert.equal(c.sbDetectInstitutionImpersonationPatchV1(text,links,institution).minimumMedium,false);
 const phishing='Enter TAN and password immediately at https://impots.gouv.fr.evil.example/login';
 assert.equal(c.sbDetectStrongPhishingV8(phishing,['https://impots.gouv.fr.evil.example/login'],institution).hardHigh,true);
 assert.equal(c.sbHostMatchesInstitution('evilimpots.gouv.fr','impots.gouv.fr',institution),false);
});

test('French credential prohibition is not a request, even with real TAN context',()=>{
 assert.equal(engine.hardCredentialRequest('Montant 184 €. https://www.impots.gouv.fr N’envoyez aucun mot de passe ni code TAN.'),false);
 assert.equal(engine.hardCredentialRequest("Montant 184 €. https://www.impots.gouv.fr N'envoyez aucun mot de passe ni code TAN."),false);
 assert.equal(engine.hardCredentialRequest('Envoyez votre mot de passe et code TAN à https://bad.example'),true);
});

test('source citation IDs expand to exact original passages and invalid IDs fail validation',async()=>{
 const full=fixture.draft();const passages=engine.sourcePassages(fixture.source);
 const prepared=Object.fromEntries(Object.keys(engine.preparationSchema.properties).map(k=>[k,full[k]]));prepared.facts=[];
 const r=fixture.review();r.facts=[];r.calculations=[];r.actions=[{text:'Wyjaśnij treść pisma.',quotes:[1]}];r.consequences=[];r.institution={name:'',country:'',officialWebsite:'',confidence:0,quote:0};
 const out=await harness([r],{stage:'review',draft:prepared}).run();
 assert.equal(out.evidence.actions[0].quotes[0],passages[1]);
 r.actions[0].quotes=[999999];await assert.rejects(harness([r],{stage:'review',draft:prepared}).run(),e=>e.code==='LETTER_INCOMPLETE');
});

test('DGFiP source header resolves to the French tax institution and country',()=>{
 const fs=require('fs'),vm=require('vm'),path=require('path'),dir=path.resolve(__dirname,'../netlify/functions');
 const c={exports:{},process:{env:{}},URL,Intl,require:n=>n==='./_usage'?{}:require(n.startsWith('.')?path.join(dir,n):n)};
 vm.runInNewContext(fs.readFileSync(path.join(dir,'analyze.js'),'utf8'),c);
 const candidate=fixture.draft();const header='DIRECTION GÉNÉRALE DES FINANCES PUBLIQUES — DGFiP';
 candidate.institution={name:header,country:'France',officialWebsite:'https://www.impots.gouv.fr/particulier',confidence:95,quote:header};
 c.applyLetterSecurity(candidate,header+'\nhttps://www.impots.gouv.fr/particulier','PL','final','FR');
 assert.equal(candidate.institution.country,'FR');assert.equal(candidate.institution.name,'Impots.gouv.fr');
});
