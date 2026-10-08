(() => {
 const valid=new Set(['PL','EN','NL','DE','UA','FR','IT','ES','PT','LT','LV','HU','ZH','JA','HI','AR','EG','ET','RO','HR','FI','SV','NO','DA']);
 const requested=(new URLSearchParams(location.search).get('lang')||'').toUpperCase();
 if(valid.has(requested)){
  let done=false;
  const apply=()=>{if(done||typeof setUiLang!=='function')return;done=true;setUiLang(requested);const output=document.getElementById('userLang');if(output){output.value=requested;output.dispatchEvent(new Event('change',{bubbles:true}));}};
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',apply,{once:true});else apply();
 }
})();
