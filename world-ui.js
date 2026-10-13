(function(){
'use strict';
const catalog=window.SBWorldCatalog.languages,version=window.SBWorldCatalog.version;
const originalCodes=new Set(['PL','UA','NL','EN','DE','FR','IT','ES','PT','LT','LV','HU','ZH','JA','HI','AR','EG','ET','RO','HR','FI','SV','NO','DA']);
const startupSaved=localStorage.getItem('sb_ui_lang_v1');
const loaded=new Set(originalCodes),pending=new Map(),bundleCache=new Map();let source,activeGeneration=0,languageButton;
const $=id=>document.getElementById(id);
function setPath(object,path,value){const parts=path.split('/').slice(1);let current=object;for(const p of parts.slice(0,-1))current=current[p];current[parts.at(-1)]=value}
function flatten(value,path='',out={}){if(typeof value==='string')out[path]=value;else if(value&&typeof value==='object')for(const [k,v] of Object.entries(value))flatten(v,path+'/'+k,out);return out}
function clone(value){return JSON.parse(JSON.stringify(value))}
function hydrate(value){if(value&&value.__sbFunction===true)return n=>Number(n)===1?value.one:value.many.replaceAll('{value}',String(n));if(Array.isArray(value))return value.map(hydrate);if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).map(([k,v])=>[k,hydrate(v)]));return value;}
async function translatePack(code){
 if(loaded.has(code))return;
 if(pending.has(code))return pending.get(code);
 const task=(async()=>{
  if(!source){const response=await fetch('languages/ui-source.json');if(!response.ok)throw Error('source');source=await response.json()}
  const key='sb_ui_pack_static_1_'+version+'_'+code;let pack;
  try{pack=JSON.parse(localStorage.getItem(key)||'null')}catch(_){}
  if(pack){const values=flatten(pack);if(Object.keys(values).length!==Object.keys(source.strings).length||Object.keys(source.strings).some(k=>typeof values[k]!=='string'))pack=null;}
  if(!pack){const group=code[0];if(!bundleCache.has(group))bundleCache.set(group,(async()=>{const response=await fetch('languages/packs/'+group+'.json');if(!response.ok)throw Error('dictionary');return response.json()})());let bundle;try{bundle=await bundleCache.get(group)}catch(error){bundleCache.delete(group);throw error}const data=bundle?.packs?.[code];if(!data)throw Error('dictionary');if(data.language!==code||data.version!==version||!data.strings||Object.keys(data.strings).length!==Object.keys(source.strings).length||Object.keys(source.strings).some(k=>typeof data.strings[k]!=='string'))throw Error('structure');pack=clone(source.template);for(const [path,text]of Object.entries(data.strings))setPath(pack,path,text);try{localStorage.setItem(key,JSON.stringify(pack))}catch(_){}}
  pack=hydrate(pack);
  for(const [module,value]of Object.entries(pack))(window.SB_I18N.modules[module]||=Object.create(null))[code]=value;
  const flags=window.SB_I18N.modules.m8495_FLAGS;flags[code]=countryFlag(catalog[code].countries[0])+' '+catalog[code].native;
  if(window.SBJobCopy&&pack.job_copy)window.SBJobCopy[code]=pack.job_copy;
  loaded.add(code);
 })();pending.set(code,task);try{return await task}finally{pending.delete(code)}
}
function countryFlag(c){return /^[A-Z]{2}$/.test(c||'')?String.fromCodePoint(...[...c].map(x=>127397+x.charCodeAt(0))):'🌐'}
function notice(text){let e=$('sbWorldNotice');if(!e){e=document.createElement('p');e.id='sbWorldNotice';e.setAttribute('role','status');e.style.cssText='padding:10px 14px;background:#edf5f0;color:#174b3e;border-radius:10px;font:600 14px/1.4 SBSoft,SBWorldBase,SBWorldArabic,SBWorldArmenian,SBWorldBengali,SBWorldTibetan,SBWorldCanadian,SBWorldMongolian,SBWorldEthiopic,SBWorldDevanagari,SBWorldGeorgian,SBWorldHebrew,SBWorldTelugu,SBWorldTamil,SBWorldGujarati,SBWorldKannada,SBWorldMalayalam,SBWorldOriya,SBWorldGurmukhi,SBWorldOlchiki,SBWorldKhmer,SBWorldLao,SBWorldSinhala,SBWorldMyanmar,SBWorldThaana,SBWorldThai,SBWorldHangul,SBWorldEastasia,system-ui';$('sbLocaleSearch')?.insertAdjacentElement('afterend',e)}e.textContent=text;return e}
async function ensure(code){if(loaded.has(code))return true;if(!catalog[code])return false;const t=window.SB_I18N.modules.world_messages?.[typeof UI!=='undefined'?UI.lang:'EN']||window.SB_I18N.modules.world_messages?.EN;const e=notice(t?.loading||'Preparing your language…');e.setAttribute('role','status');try{await translatePack(code);e.textContent='';return true}catch(_){e.setAttribute('role','alert');e.textContent=t?.error||'The language could not be loaded. Your previous language and document have been kept. Please try again.';return false}}
function repairStatic(){const code=typeof UI!=='undefined'?UI.lang:'PL';if(originalCodes.has(code)||!loaded.has(code))return;
 const translations=new Map();for(const map of Object.values(window.SB_I18N.modules)){if(!map||typeof map!=='object'||!map[code])continue;const target=flatten(map[code]);for(const original of [map.EN,map.PL]){if(!original)continue;for(const [k,v] of Object.entries(flatten(original))){if(v&&target[k])translations.set(v.replace(/\s+/g,' ').trim(),target[k])}}}
 const walker=document.createTreeWalker(document.body,NodeFilter.SHOW_TEXT);let node;
 while((node=walker.nextNode())){const parent=node.parentElement;if(!parent||parent.closest('script,style,textarea,input,pre,#sbLocaleList,#inputText,#summary,#translation,#examples,#examplesDoc'))continue;const key=node.textContent.replace(/\s+/g,' ').trim();const translated=translations.get(key);if(translated&&translated!==node.textContent)node.textContent=translated}
 document.documentElement.lang=catalog[code].locale;document.documentElement.dir=catalog[code].rtl?'rtl':'ltr';
}
function restoreOutput(code){if(originalCodes.has(code))return;const select=$('userLang');if(select&&select.value!==code){select.value=code;select.dispatchEvent(new Event('change',{bubbles:true}))}const region=$('sbRegion'),saved=localStorage.getItem('sb_region_'+code)||'';if(region){region.value=saved;region.dispatchEvent(new Event('change',{bubbles:true}))}}
function install(){
 for(const [code,entry] of Object.entries(catalog)){SB_REGION_COUNTRIES[code]=entry.countries;
  if(!Object.values(window.SB_I18N.modules).some(m=>m&&m[code])){
   const flags=window.SB_I18N.modules.m8495_FLAGS;flags[code]=countryFlag(entry.countries[0])+' '+entry.native;
  }
  for(const id of ['userLang','sourceLang','sbJobReplyLanguage']){const select=$(id);if(select&&![...select.options].some(o=>o.value===code)){select.add(new Option(countryFlag(entry.countries[0])+' '+entry.native,code))}}
 }
 const legacyMenu=document.querySelector('.ui-switch');if(legacyMenu){for(const [code,entry] of Object.entries(catalog)){if(legacyMenu.querySelector('[data-ui="'+code+'"]'))continue;const button=document.createElement('button');button.type='button';button.className='ui-btn';button.dataset.ui=code;button.textContent=countryFlag(entry.countries[0])+' '+entry.native;button.onclick=()=>window.setUiLang(code);legacyMenu.append(button)}}
 window.SB_I18N.modules.world_messages={EN:{loading:'Preparing your language…',error:'The language could not be loaded. Your previous language and document have been kept. Please try again.'},PL:{loading:'Przygotowuję Twój język…',error:'Nie udało się wczytać języka. Zachowano poprzedni język i dokument. Spróbuj ponownie.'}};
 window.SBWorldUI={ensure,repairStatic,catalog,loaded};
 const old=window.setUiLang;
 window.setUiLang=function(code){const L=String(code||'').toUpperCase();if(!catalog[L])return old.apply(this,arguments);if(!loaded.has(L)){const generation=++activeGeneration;ensure(L).then(ok=>{if(ok&&generation===activeGeneration){old.call(this,L);restoreOutput(L);repairStatic()}});return}++activeGeneration;const result=old.apply(this,arguments);restoreOutput(L);repairStatic();setTimeout(repairStatic,80);return result};
  document.addEventListener('change',async event=>{const select=event.target;if(!select||select.id!=='userLang')return;const code=select.value;if(!catalog[code]||loaded.has(code))return;event.stopImmediatePropagation();const previous=select.dataset.sbPreviousValue||'PL';select.value=previous;select.disabled=true;try{if(await ensure(code)){select.value=code;select.dispatchEvent(new Event('change',{bubbles:true}));if(select.id==='userLang')window.setUiLang(code)}}finally{select.disabled=false}},true);
 document.addEventListener('focusin',event=>{if(event.target?.tagName==='SELECT')event.target.dataset.sbPreviousValue=event.target.value});
 let repairTimer;new MutationObserver(()=>{clearTimeout(repairTimer);repairTimer=setTimeout(repairStatic,100)}).observe(document.body,{childList:true,subtree:true});
 const saved=startupSaved;if(saved&&catalog[saved]&&!originalCodes.has(saved))window.setUiLang(saved);
}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',()=>setTimeout(install,850),{once:true});else setTimeout(install,850);
})();
