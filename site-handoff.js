(() => {
 const requested=(new URLSearchParams(location.search).get('lang')||'').toUpperCase();
 const apply=async()=>{if(!window.SBWorldCatalog?.languages[requested]||!window.SBWorldUI)return;if(await window.SBWorldUI.ensure(requested)){window.setUiLang(requested);const output=document.getElementById('userLang');if(output){output.value=requested;output.dispatchEvent(new Event('change',{bubbles:true}));}}};
 if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',()=>setTimeout(apply,1000),{once:true});else setTimeout(apply,1000);
})();
