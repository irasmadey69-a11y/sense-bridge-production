(function(root){
 const messages={
  PL:'Nie udało się zakończyć analizy. Spróbuj ponownie. Nie zużyto bezpłatnego użycia.',
  EN:'The analysis could not be completed. Please try again. No free use was deducted.',
  NL:'De analyse kon niet worden voltooid. Probeer het opnieuw. Er is geen gratis gebruik afgetrokken.',
  DE:'Die Analyse konnte nicht abgeschlossen werden. Bitte versuchen Sie es erneut. Es wurde keine kostenlose Nutzung abgezogen.',
  FR:"L’analyse n’a pas pu être terminée. Réessayez. Aucune utilisation gratuite n’a été déduite.",
  ES:'No se pudo completar el análisis. Inténtalo de nuevo. No se ha descontado ningún uso gratuito.',
  IT:'Non è stato possibile completare l’analisi. Riprova. Nessun utilizzo gratuito è stato scalato.',
  PT:'Não foi possível concluir a análise. Tente novamente. Nenhuma utilização gratuita foi descontada.',
  UA:'Не вдалося завершити аналіз. Спробуйте ще раз. Безкоштовне використання не списано.',
  RU:'Не удалось завершить анализ. Попробуйте ещё раз. Бесплатное использование не списано.',
  LT:'Analizės užbaigti nepavyko. Bandykite dar kartą. Nemokamas naudojimas nenuskaičiuotas.',
  LV:'Analīzi neizdevās pabeigt. Mēģiniet vēlreiz. Bezmaksas lietošanas reize nav atskaitīta.',
  HU:'Az elemzés nem fejezhető be. Próbálja újra. Nem vontunk le ingyenes használatot.',
  ZH:'未能完成分析。请重试。未扣除免费使用次数。',
  JA:'分析を完了できませんでした。もう一度お試しください。無料利用回数は減っていません。',
  HI:'विश्लेषण पूरा नहीं हो सका। फिर से प्रयास करें। मुफ़्त उपयोग की संख्या नहीं घटी है।',
  AR:'تعذّر إكمال التحليل. حاول مرة أخرى. لم يُخصم أي استخدام مجاني.',
  EG:'التحليل ما اكتملش. جرّب تاني. ما اتخصمتش أي محاولة مجانية.',
  ET:'Analüüsi ei saanud lõpetada. Proovige uuesti. Tasuta kasutuskorda ei arvestatud maha.',
  RO:'Analiza nu a putut fi finalizată. Încercați din nou. Nu s-a scăzut nicio utilizare gratuită.',
  HR:'Analizu nije bilo moguće dovršiti. Pokušajte ponovno. Nije oduzeto besplatno korištenje.',
  SK:'Analýzu sa nepodarilo dokončiť. Skúste to znova. Bezplatné použitie sa neodpočítalo.',
  CS:'Analýzu se nepodařilo dokončit. Zkuste to znovu. Bezplatné použití nebylo odečteno.',
  TR:'Analiz tamamlanamadı. Tekrar deneyin. Ücretsiz kullanım hakkınız düşülmedi.'
 };
 function message(lang,code){
  if(lang==='PL'){
   if(code==='LETTER_TIMEOUT')return 'Analiza trwała zbyt długo. Spróbuj ponownie. Nie zużyto bezpłatnego użycia.';
   if(code==='LETTER_TOO_LONG')return 'To pismo jest za długie na jedną analizę. Podziel je na części, zachowując powiązane warunki i terminy. Nie zużyto bezpłatnego użycia.';
   if(code==='LETTER_UNVERIFIED'||code==='LETTER_INCOMPLETE')return 'Nie udało się zakończyć sprawdzania wyniku analizy. Spróbuj ponownie. Nie zużyto bezpłatnego użycia.';
  }
  return messages[lang]||messages.EN;
 }
 function error(code){const e=new Error(code);e.code=code;return e;}
 function sameInstitution(a,b){
  const key=value=>String(value||'').normalize('NFKC').toLowerCase().trim()
   .replace(/^(.{6,}?)\s*\([^()]{1,50}\)$/u,'$1')
   .replace(/\s+(?:hogeschool|university(?: of applied sciences)?|universiteit|college)$/u,'')
   .replace(/[^\p{L}\p{N}]/gu,'');
  const first=key(a),second=key(b);return !!first&&first===second;
 }
 function partialResult(draft,lang,reason){
  const translation=String(draft?.translation||'').trim();
  if(!translation)return null;
  const notice=String(draft.fallbackNotice||'').trim()||(lang==='PL'?'Tłumaczenie jest dostępne, ale dodatkowa kontrola wyniku nie została zakończona. Wynik może być niepełny. Sprawdź szczególnie daty, godziny i kwoty.':'The translation is available, but additional checks could not be completed. The result may be incomplete. Check dates, times and amounts.');
  const replies={neutral:'',polite:'',firm:''};
  return {ok:true,pipeline:'letter-evidence-v1',qualityChecked:false,analysisStatus:'partial',analysisWarning:notice,validationReason:reason||'REVIEW_UNAVAILABLE',translationComplete:!!draft.translationComplete,translation,summary:notice,whatOfficeSays:notice,detectedLang:draft.detectedLang,actions:[],consequences:[],nextSteps:[],help:[],helpLinks:[],risks:[notice],responseRequired:'UNKNOWN',urgency:'UNKNOWN',legalHelpNeeded:'NONE',replyIntent:'NO_REPLY',replyGuidance:notice,replies,repliesDocument:{...replies},examples:{...replies},fraudRisk:{level:'UNKNOWN',confidence:0,label:notice,summary:notice,signals:[],suspiciousElements:[],safeSteps:[],disclaimer:notice},institution:{name:'',country:'',officialWebsite:'',confidence:0},institutionSearch:{status:'unavailable',institutions:[]}};
 }
 async function request(url,body,fetcher=root.fetch.bind(root),timeoutMs=55000){
  if(body.mode==='letter'&&!body.letterStage){
   const first=await request(url,{...body,letterStage:'draft'},fetcher,timeoutMs);
   let result;
   try{result=await request(url,{...body,letterStage:'review',letterDraft:first.draft},fetcher,timeoutMs);}
   catch(e){result=partialResult(first.draft,body.userLang,e.code);if(!result)throw e;}
   try{
    result.institutionSearch=await request(url,{...body,letterStage:'institutions'},fetcher,timeoutMs);
    const matches=result.institutionSearch.institutions.filter(x=>x.verification==='web');
    const primary=matches.find(x=>sameInstitution(x.name,result.institution?.name))||(!result.institution?.name&&matches.length===1?matches[0]:null);
    if(primary)result.institution={...result.institution,...primary};
    result.helpLinks=[...(result.helpLinks||[]),...matches.filter(x=>!(result.helpLinks||[]).some(link=>link.url===x.officialWebsite)).map(x=>({label:x.name,url:x.officialWebsite}))];
   }catch{result.institutionSearch={status:'unavailable',institutions:[]};}
   return result;
  }
  const controller=new AbortController();let timer;
  const deadline=new Promise((_,reject)=>{timer=setTimeout(()=>{controller.abort();reject(error('LETTER_TIMEOUT'));},timeoutMs);});
  const work=(async()=>{
   const response=await fetcher(url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body),signal:controller.signal});
   const raw=await response.text();let data;try{data=JSON.parse(raw);}catch{throw error('LETTER_UPSTREAM');}
   if(!response.ok||data.ok===false){if(data.validationStage&&root.console)root.console.warn('Sense Bridge validation stage:',data.validationStage);throw error(data.errorCode||'LETTER_UPSTREAM');}
   if(body.letterStage==='institutions'){
    if(!Array.isArray(data.institutions)||!['verified','unverified','unidentified','unavailable'].includes(data.status))throw error('LETTER_INCOMPLETE');
    return data;
   }
   if(body.letterStage==='draft'){
    if(data?.ok!==true||data.stage!=='draft'||data.pipeline!=='letter-evidence-v1'||!data.draft||typeof data.draft!=='object')throw error('LETTER_INCOMPLETE');
    return data;
   }
   if(!data||typeof data!=='object'||!String(data.summary||'').trim())throw error('LETTER_INCOMPLETE');
   if(data.pipeline==='letter-evidence-v1'){
    const partial=data.analysisStatus==='partial'&&data.qualityChecked===false&&String(data.analysisWarning||'').trim();
    if((!data.qualityChecked&&!partial)||!String(data.translation||'').trim())throw error('LETTER_INCOMPLETE');
   }
   return data;
  })();
  try{return await Promise.race([work,deadline]);}
  catch(e){if(controller.signal.aborted)throw error('LETTER_TIMEOUT');throw e;}
  finally{clearTimeout(timer);controller.abort();}
 }
 root.SBLetterRequest={request,message,sameInstitution};
 if(typeof module!=='undefined'&&module.exports)module.exports=root.SBLetterRequest;
})(typeof window==='undefined'?globalThis:window);

