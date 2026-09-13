/* Sense Bridge — final visible-language sync, 2026-09-13.
   Presentation only. Reuses the translations already present in the app.
   It does not change access records, counters, users or admin statistics. */
(function(w){
  "use strict";

  function code(){
    try{
      if(typeof UI!=="undefined" && UI && UI.lang) return String(UI.lang).toUpperCase();
    }catch(_){ }
    try{return String(localStorage.getItem("sb_ui_lang_v1")||"PL").toUpperCase();}catch(_){return "PL";}
  }

  function textPack(L){
    try{
      if(typeof UI!=="undefined" && UI && UI.dict){
        return UI.dict[L] || UI.dict.EN || UI.dict.PL || {};
      }
    }catch(_){ }
    const M=(w.SB_I18N&&w.SB_I18N.modules)||{};
    return (M.ui_main&&M.ui_main[L])||(M.ui_main&&M.ui_main.EN)||(M.ui_main&&M.ui_main.PL)||{};
  }

  function setText(id,value){
    const el=document.getElementById(id);
    if(el && value!=null && value!=="") el.textContent=String(value);
  }

  function sync(){
    const L=code();
    const M=(w.SB_I18N&&w.SB_I18N.modules)||{};
    const t=textPack(L);

    /* Access card: force a fresh render in the newly selected UI language. */
    try{ if(typeof updatePaidMessage==="function") updatePaidMessage(); }catch(_){ }
    try{ if(typeof refreshUI==="function") refreshUI(); }catch(_){ }
    try{ if(typeof updatePaidMessage==="function") updatePaidMessage(); }catch(_){ }

    /* Buttons that stopped following language after the tool row was reduced. */
    const clear=document.getElementById("btnClearData");
    if(clear && t.clear){
      if(typeof sbClearButtonHtml==="function") clear.innerHTML=sbClearButtonHtml(t.clear);
      else clear.textContent=t.clear;
    }

    const pdf=document.getElementById("btnPrintPdf");
    const ux=(M.m7463_SB_UX_V10_TEXT&&M.m7463_SB_UX_V10_TEXT[L]) ||
             (M.m7463_SB_UX_V10_TEXT&&M.m7463_SB_UX_V10_TEXT.EN) ||
             (M.m7463_SB_UX_V10_TEXT&&M.m7463_SB_UX_V10_TEXT.PL);
    if(pdf && ux && ux.printPdf) pdf.textContent=ux.printPdf;

    /* Footer/legal row: use the same proven language dictionary as the old working app. */
    setText("footerPrivacy",t.footerPrivacy);
    setText("footerTerms",t.footerTerms);
    setText("footerContact",t.footerContact);
    setText("footerText",t.footerDefault);

    /* Source language AUTO label also follows UI language. */
    try{
      const src=document.getElementById("sourceLang");
      if(src && src.options && src.options.length && t.srcAuto) src.options[0].textContent=t.srcAuto;
    }catch(_){ }
  }

  w.sbSyncVisibleLanguage=sync;

  function install(){
    /* Wrap the final setUiLang (after all other app wrappers). */
    try{
      if(typeof w.setUiLang==="function" && !w.setUiLang.__sbFinalLangSync){
        const old=w.setUiLang;
        const wrapped=function(){
          const r=old.apply(this,arguments);
          setTimeout(sync,0);
          setTimeout(sync,120);
          return r;
        };
        wrapped.__sbFinalLangSync=true;
        w.setUiLang=wrapped;
      }
    }catch(_){ }

    document.addEventListener("click",function(e){
      if(e.target && e.target.closest && e.target.closest("[data-ui]")){
        setTimeout(sync,20);
        setTimeout(sync,160);
      }
    },true);

    sync();
    setTimeout(sync,150);
  }

  if(document.readyState==="loading") document.addEventListener("DOMContentLoaded",install,{once:true});
  else install();
})(window);
