(function(){
  'use strict';
  const el=id=>document.getElementById(id);
  const locale=lang=>({UA:'uk',EG:'ar',ZH:'zh-Hans'})[lang]||lang.toLowerCase();
  const copy=lang=>window.SBJobCopy[lang]||window.SBJobCopy.EN;
  const countryCodes=['NL','BE','DE','FR','PL','GB','IE','ES','PT','IT','AT','CH','SE','NO','DK','FI','LT','LV','EE','HU','RO','HR','UA','CZ','SK','SI','GR','CY','MT','LU','IS','US','CA','AU','NZ','JP','CN','IN','EG','AE','BR','ZA'];
  let selectedLang='PL',outputLang='PL',last=null,running=false,uiCopy={};
  function options(id,list){
    const select=el(id),value=select.value;select.replaceChildren();
    list.forEach(([v,label])=>{const option=document.createElement('option');option.value=v;option.textContent=label;select.append(option);});
    if(list.some(([v])=>v===value))select.value=value;
  }
  function apply(active,lang,outLang,common){
    uiCopy=common||uiCopy;
    selectedLang=lang;outputLang=outLang;const t=copy(lang);
    el('sbJobDetails').hidden=!active;
    el('sbJobMissing').hidden=!active||!last;
    el('sbJobDetailsLabel').textContent=t.details;
    el('sbJobComplete').textContent=t.complete;
    el('sbJobFollowup').hidden=!active||!last;
    for(const [id,key] of [['sbJobCountryLabel','country'],['sbJobAgeLabel','age'],['sbJobDateLabel','date'],['sbJobContractLabel','contract'],['sbJobProfileLabel','profile'],['sbJobPreferencesLabel','preferences'],['sbJobReplyLanguageLabel','replyLanguage'],['sbJobAsk','ask'],['sbJobApply','apply'],['sbJobConversation','conversation'],['sbJobCopy','copy']])el(id).textContent=t[key];
    options('sbJobContract',[['unknown',t.unknown],['employee',t.employee],['apprentice',t.apprentice],['self_employed',t.selfEmployed]]);
    let names;try{names=new Intl.DisplayNames([locale(lang)],{type:'region'});}catch{}
    const available=typeof SB_ALL_COUNTRIES!=='undefined'?[...new Set([...countryCodes,...SB_ALL_COUNTRIES])]:countryCodes;
    options('sbJobCountry',[['',t.unknown],...available.map(code=>[code,names?names.of(code):code])]);
    let languages;try{languages=new Intl.DisplayNames([locale(lang)],{type:'language'});}catch{}
    const list=Object.keys(window.SBJobCopy).map(code=>[code,languages?languages.of(locale(code)):code]);
    options('sbJobReplyLanguage',list);
    if(!el('sbJobReplyLanguage').dataset.chosen)el('sbJobReplyLanguage').value=outLang;
    el('sbJobReplyLanguage').onchange=()=>{el('sbJobReplyLanguage').dataset.chosen='1';};
    if(!el('sbJobDate').value)el('sbJobDate').value=(()=>{const d=new Date();return [d.getFullYear(),String(d.getMonth()+1).padStart(2,'0'),String(d.getDate()).padStart(2,'0')].join('-');})();
    el('sbJobContext').dir=['AR','EG'].includes(lang)?'rtl':'ltr';
    if(active&&last)render(last.data,last.request);
  }
  function values(){
    return {country:el('sbJobCountry').value,age:el('sbJobAge').value?Number(el('sbJobAge').value):null,date:el('sbJobDate').value,contract:el('sbJobContract').value,profile:el('sbJobProfile').value,preferences:el('sbJobPreferences').value,replyLang:el('sbJobReplyLanguage').value};
  }
  function clear(){last=null;el('sbJobDetails').open=false;el('sbJobMissing').hidden=true;el('sbJobFollowup').hidden=true;el('sbJobDraft').hidden=true;el('sbJobDraftText').textContent='';}
  function render(data,request){
    last={data,request};const t=copy(outputLang),w=data.comparison;
    if(data.resolvedContext){
      if(!el('sbJobCountry').value)el('sbJobCountry').value=data.resolvedContext.country||'';
      if(el('sbJobContract').value==='unknown')el('sbJobContract').value=data.resolvedContext.contract||'unknown';
    }
    const fields=[];
    if(!w.country)fields.push(t.country);
    if(!request.age)fields.push(t.age);
    if((data.resolvedContext?.contract||request.contract)==='unknown')fields.push(t.contract);
    el('sbJobMissing').hidden=w.status!=='UNAVAILABLE'||!fields.length;
    el('sbJobMissingText').textContent=t.missingDetails+' '+fields.join(', ');
    el('sbJobComplete').textContent=el('sbJobDetails').open?t.recalculate:t.complete;
    [1,2,3,4,5,6].forEach(i=>{el('sbDocLabR'+i).closest('.sb-doclab-result-card').style.display='';});
    const labelKeys=['work','conditions','requirements','wage','questions','fit'];
    labelKeys.forEach((key,i)=>el('sbDocLabL'+(i+1)).textContent=t[key]);
    [1,2,3,5,6].forEach((id,i)=>el('sbDocLabR'+id).textContent=data.sections[i]);
    const box=el('sbDocLabR4');box.replaceChildren();
    const n=v=>new Intl.NumberFormat(locale(outputLang),{maximumFractionDigits:2,minimumFractionDigits:2}).format(v);
    const unit=w.unit==='hour'?t.hour:t.month;
    const line=s=>box.append(document.createTextNode(s+'\n'));
    if(w.minimum!=null)line(t.reference+': '+n(w.minimum)+' '+w.currency+' '+t.gross+'/'+unit+(w.country==='BE'?' (GGMMI)':''));
    if(w.status==='UNAVAILABLE'){
      line(w.reason==='sector'?t.sector:w.reason==='reference'?t.referenceUnavailable:t.missing);
    }else{
      const sign=v=>v>0?'+':'';
      const range=(a,b,suffix)=>sign(a)+n(a)+(a!==b?' … '+sign(b)+n(b):'')+suffix;
      line(t.difference+': '+range(w.differenceMin,w.differenceMax,' '+w.currency+'/'+unit));
      line(range(w.percentMin,w.percentMax,'%'));
    }
    if(w.source){
      const a=document.createElement('a');a.href=w.source;a.target='_blank';a.rel='noopener noreferrer';a.textContent=t.source;box.append(a,document.createTextNode('\n'));
      line(t.checked+': '+w.checkedAt+' | '+t.date+': '+w.date);
    }
    if(w.sectorSource){const a=document.createElement('a');a.href=w.sectorSource;a.target='_blank';a.rel='noopener noreferrer';a.textContent=t.source+' (BE)';box.append(a,document.createTextNode('\n'));}
    line(t.note);
    el('sbJobFollowup').hidden=false;
  }
  async function followup(action){
    if(!last||running)return;
    const left=typeof getAiToolsTrialLeft==='function'?getAiToolsTrialLeft():0;
    if(left<=0){el('sbDocLabStatus').textContent=typeof sbAiLockedText==='function'?sbAiLockedText():copy(selectedLang).missing;return;}
    running=true;
    const buttons=['sbJobAsk','sbJobApply','sbJobConversation'];buttons.forEach(id=>el(id).disabled=true);el('sbDocLabRun').disabled=true;
    const oldStatus=el('sbDocLabStatus').textContent;el('sbDocLabStatus').textContent=uiCopy.analyzing||copy(selectedLang).run+'…';
    try{
      const request={...last.request,...values(),action,replyLang:el('sbJobReplyLanguage').value,userLang:outputLang};
      const response=await fetch('/.netlify/functions/ai-job-offer',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(request)});
      const data=await response.json();if(!response.ok||!data.ok)throw new Error();
      el('sbJobDraftText').textContent=data.result;el('sbJobDraft').hidden=false;el('sbJobCopy').textContent=copy(selectedLang).copy;
      if(typeof setAiToolsTrialLeft==='function')setAiToolsTrialLeft(left-1);
      if(typeof trackEvent==='function')await trackEvent('ai_job_'+action);
      el('sbDocLabStatus').textContent=oldStatus;
      el('sbJobDraft').scrollIntoView({behavior:'smooth',block:'nearest'});
    }catch{el('sbDocLabStatus').textContent=uiCopy.error||copy(selectedLang).missing;}
    finally{running=false;buttons.forEach(id=>el(id).disabled=false);el('sbDocLabRun').disabled=false;}
  }
  async function complete(){
    if(!last||running)return;
    const details=el('sbJobDetails');
    if(!details.open){details.open=true;el('sbJobComplete').textContent=copy(selectedLang).recalculate;details.scrollIntoView({behavior:'smooth',block:'start'});return;}
    running=true;el('sbJobComplete').disabled=true;
    try{
      const request={...last.request,...values(),action:'compare',salary:last.data.salary};
      const response=await fetch('/.netlify/functions/ai-job-offer',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(request)});
      const result=await response.json();if(!response.ok||!result.ok)throw new Error();
      const data={...last.data,comparison:result.comparison,resolvedContext:request};
      render(data,request);
      el('sbDocLabR4').scrollIntoView({behavior:'smooth',block:'center'});
    }catch{el('sbDocLabStatus').textContent=uiCopy.error||copy(selectedLang).missing;}
    finally{running=false;el('sbJobComplete').disabled=false;}
  }
  function init(){
    el('sbJobComplete').onclick=complete;
    el('sbJobDetails').ontoggle=()=>{el('sbJobComplete').textContent=el('sbJobDetails').open?copy(selectedLang).recalculate:copy(selectedLang).complete;};
    el('sbJobAsk').onclick=()=>followup('ask');el('sbJobApply').onclick=()=>followup('apply');el('sbJobConversation').onclick=()=>followup('conversation');
    el('sbJobCopy').onclick=async()=>{
      try{await navigator.clipboard.writeText(el('sbJobDraftText').textContent);el('sbJobCopy').textContent=copy(selectedLang).copied;}
      catch{const range=document.createRange();range.selectNodeContents(el('sbJobDraftText'));const selection=window.getSelection();selection.removeAllRanges();selection.addRange(range);}
    };
  }
  window.SBJobUI={apply,values,clear,render};
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init);else init();
})();
