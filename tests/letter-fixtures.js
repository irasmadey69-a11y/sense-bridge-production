const source='Kwota 100 EUR. Wpłacono 40 EUR. Pozostało 60 EUR do 30 listopada 2026. Kopię dokumentu dostarcz przed 20 listopada 2026, jeśli jesteś zatrudniony. Nie opisano sankcji.';
function draft(){return {
 calculations:[],detectedLang:'PL',translation:source,translationComplete:true,fallbackNotice:'Tłumaczenie jest dostępne, ale dodatkowa kontrola wyniku nie została zakończona. Wynik może być niepełny. Sprawdź daty, godziny i kwoty.',
 facts:[{kind:'AMOUNT',quote:'Pozostało 60 EUR do 30 listopada 2026.',explanation:'Pozostało 60 EUR do 30 listopada 2026.',status:'CURRENT'},{kind:'REQUEST',quote:'Kopię dokumentu dostarcz przed 20 listopada 2026, jeśli jesteś zatrudniony.',explanation:'Jeśli jesteś zatrudniony, dostarcz kopię przed 20 listopada 2026.',status:'CURRENT'}],
 summary:'Według pisma pozostało 60 EUR do 30 listopada 2026. Jeśli jesteś zatrudniony, kopię dokumentu trzeba dostarczyć przed 20 listopada 2026.',
 actions:[{text:'Jeśli jesteś zatrudniony, dostarcz kopię dokumentu przed 20 listopada 2026.',quotes:['Kopię dokumentu dostarcz przed 20 listopada 2026, jeśli jesteś zatrudniony.']}],consequences:[],actionRequired:'YES',noRequiredActionText:'',responseRequired:'YES',urgency:'MEDIUM',legalHelpNeeded:'NONE',documentTone:'formalny',replyIntent:'ACKNOWLEDGE_ONLY',replyGuidance:'',
 replies:{neutral:'Dziękuję za wiadomość. Proszę o potwierdzenie sposobu przesłania kopii.',polite:'Uprzejmie dziękuję za wiadomość. Proszę o potwierdzenie sposobu przesłania kopii.',firm:'Proszę o jednoznaczne wskazanie sposobu przesłania kopii.'},
 repliesDocument:{neutral:'Dziękuję za wiadomość. Proszę o potwierdzenie sposobu przesłania kopii.',polite:'Uprzejmie dziękuję za wiadomość. Proszę o potwierdzenie sposobu przesłania kopii.',firm:'Proszę o jednoznaczne wskazanie sposobu przesłania kopii.'},
 risks:[],communicationRiskNotice:'Nie wykryto wyraźnych ryzyk komunikacyjnych w tej treści.',help:[],institution:{name:'',country:'',officialWebsite:'',confidence:0,quote:''},
 fraudRisk:{findings:[],level:'UNKNOWN',confidence:0,label:'Nie potwierdzono nadawcy',summary:'Brak danych do potwierdzenia autentyczności.',signals:[],suspiciousElements:[],safeSteps:[],disclaimer:'To analiza ryzyka, nie potwierdzenie autentyczności.'},detectedLinks:[],suspiciousLinks:[],detectedPhones:[]
};}
function review(d=draft()){
 const r=JSON.parse(JSON.stringify(d));for(const k of ['detectedLang','translation'])delete r[k];
 return {verified:true,translationCorrection:'',...r};
}
function api(value,extra={}){return {ok:true,status:200,text:async()=>JSON.stringify({status:'completed',output_text:JSON.stringify(value),usage:{input_tokens:100,output_tokens:200},...extra})};}
module.exports={source,draft,review,api};

