const catalog=require('./_world-catalog.json');
const source=require('./_ui-source.json');
const {recordUsage}=require('./_usage');
const headers={'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'Content-Type','Access-Control-Allow-Methods':'POST, OPTIONS'};
const reply=(statusCode,body)=>({statusCode,headers,body:JSON.stringify(body)});
function extract(data){return data.output_text||(data.output||[]).flatMap(x=>x.content||[]).map(x=>x.text||'').join('')}
function protectedValues(text){return String(text).match(/https?:\/\/[^\s<>"']+|[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}|\{[^{}]+\}|<\/?[a-z][^>]*>|\d+(?:[.,:/-]\d+)*/gi)||[]}
exports.handler=async(event,context)=>{
 if(event.httpMethod==='OPTIONS')return reply(204,{});
 if(event.httpMethod!=='POST')return reply(405,{ok:false,error:'method'});
 let body;try{body=JSON.parse(event.body||'{}')}catch(_){return reply(400,{ok:false,error:'input'})}
 const code=typeof body.language==='string'?body.language.toUpperCase():'';const entry=catalog.languages[code];const batch=body.batch;
 const entries=Object.entries(source.strings),total=Math.ceil(entries.length/source.batchSize);
 if(!entry||!Number.isInteger(batch)||batch<0||batch>=total)return reply(400,{ok:false,error:'language_or_batch'});
 const selected=Object.fromEntries(entries.slice(batch*source.batchSize,(batch+1)*source.batchSize));
 const cacheKey=source.version+'-'+code+'-'+batch;let store;
 try{const blobs=require('@netlify/blobs');if(blobs.connectLambda)blobs.connectLambda(event);store=blobs.getStore({name:'sb-ui-language-packs',consistency:'strong'});const cached=await store.get(cacheKey,{type:'json'});if(cached&&cached.version===source.version)return reply(200,cached)}catch(_){}
 const key=process.env.OPENAI_API_KEY;if(!key)return reply(503,{ok:false,error:'language_service_unavailable'});
 try{
  const res=await fetch('https://api.openai.com/v1/responses',{method:'POST',headers:{Authorization:'Bearer '+key,'Content-Type':'application/json'},signal:AbortSignal.timeout(24000),body:JSON.stringify({model:'gpt-4o-mini',temperature:0,max_output_tokens:6000,instructions:`Translate the values of this fixed app interface dictionary into ${entry.name}, native label ${entry.native}, locale ${entry.locale}. Use natural, concise, accurate interface wording, including the correct writing system. Return ONLY a JSON object with exactly the same keys and one translated string per key. Preserve URLs, email addresses, HTML tags and attributes, placeholders in braces, emoji, numbers and the product name Sense Bridge. Do not add markup, instructions or commentary. Use the source meaning; do not invent prices, access rights, countries or features. If a source value is a language code, flag or language name keep its identifier unchanged.`,input:'Translate this dictionary and return only a JSON object with the identical keys. JSON dictionary:\n'+JSON.stringify(selected),text:{format:{type:'json_object'}}})});
  const data=await res.json();if(!res.ok)return reply(502,{ok:false,error:'translation_provider_error',providerStatus:res.status,providerCode:typeof data.error?.code==='string'?data.error.code:null});if(data.status==='incomplete')return reply(502,{ok:false,error:'translation_incomplete'});
  await recordUsage(event,context,data,{feature:'UI_TRANSLATION',uiLang:code,documentLang:'EN',accessType:'SYSTEM',model:data.model||'gpt-4o-mini'});
  const translated=JSON.parse(extract(data));const keys=Object.keys(selected);
  if(Object.keys(translated).length!==keys.length)return reply(502,{ok:false,error:'translation_structure'});
  for(const k of keys){const v=translated[k];if(typeof v!=='string'||(selected[k].trim()&&!v.trim())||v.length>Math.max(500,selected[k].length*8)||JSON.stringify(protectedValues(v))!==JSON.stringify(protectedValues(selected[k])))return reply(502,{ok:false,error:'translation_structure'})}
  const result={ok:true,version:source.version,language:code,batch,total,strings:translated};try{if(store)await store.setJSON(cacheKey,result)}catch(_){}
  return reply(200,result);
 }catch(_){return reply(502,{ok:false,error:'language_translation_unavailable'})}
};
