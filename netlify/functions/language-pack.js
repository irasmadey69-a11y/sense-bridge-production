const catalog=require('./_world-catalog.json');
const source=require('./_ui-source.json');
const {recordUsage}=require('./_usage');
const headers={'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'Content-Type','Access-Control-Allow-Methods':'POST, OPTIONS'};
const memory=new Map();
const reply=(statusCode,body)=>({statusCode,headers,body:JSON.stringify(body)});
const extract=data=>data.output_text||(data.output||[]).flatMap(x=>x.content||[]).map(x=>x.text||'').join('');
const tokens=text=>String(text).match(/https?:\/\/[^\s<>"']+|[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}|\{[^{}]+\}|<\/?[a-z][^>]*>|\d+(?:[.,:/-]\d+)*/gi)||[];
function prepare(strings){const input={},fixed={},replacements={};for(const [key,value]of Object.entries(strings)){if(!value.trim()||/^https?:\/\/\S+$/.test(value)||/^[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}$/.test(value)||key==='/m6857_langMap'||key==='/m8495_FLAGS'){fixed[key]=value;continue}const list=[];input[key]=value.replace(/https?:\/\/[^\s<>"']+|[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}|\{[^{}]+\}|<\/?[a-z][^>]*>|\d+(?:[.,:/-]\d+)*/gi,value=>{const marker='__SB_'+list.length+'__';list.push({marker,value});return marker});replacements[key]=list}return{input,fixed,replacements}}
function restore(translated,prepared,original){if(!translated||typeof translated!=='object'||Array.isArray(translated))throw Error('structure');const keys=Object.keys(prepared.input);if(Object.keys(translated).length!==keys.length)throw Error('structure');const output={...prepared.fixed};for(const key of keys){let value=translated[key];if(typeof value!=='string'||!value.trim()||value.length>Math.max(500,original[key].length*8))throw Error('structure');for(const item of prepared.replacements[key]){if(value.split(item.marker).length!==2)throw Error('protected');value=value.replace(item.marker,item.value)}if(/__SB_\d+__/.test(value)||JSON.stringify(tokens(value).sort())!==JSON.stringify(tokens(original[key]).sort())||(original[key].includes('Sense Bridge')&&!value.includes('Sense Bridge')))throw Error('protected');output[key]=value}return output}
exports.prepare=prepare;exports.restore=restore;
exports.handler=async(event,context)=>{
 if(event.httpMethod==='OPTIONS')return reply(204,{});
 if(event.httpMethod!=='POST')return reply(405,{ok:false,error:'method'});
 let body;try{body=JSON.parse(event.body||'{}')}catch(_){return reply(400,{ok:false,error:'input'})}
 const code=typeof body.language==='string'?body.language.toUpperCase():'';const entry=catalog.languages[code],batch=body.batch;
 const entries=Object.entries(source.strings),total=Math.ceil(entries.length/source.batchSize);
 if(!entry||!Number.isInteger(batch)||batch<0||batch>=total)return reply(400,{ok:false,error:'language_or_batch'});
 const selected=Object.fromEntries(entries.slice(batch*source.batchSize,(batch+1)*source.batchSize)),prepared=prepare(selected);
 const cacheKey=source.version+'-protected-2-'+code+'-'+batch;let store;
 if(memory.has(cacheKey))return reply(200,memory.get(cacheKey));
 try{const blobs=require('@netlify/blobs');try{if(blobs.connectLambda)blobs.connectLambda(event)}catch(_){}store=blobs.getStore({name:'sb-ui-language-packs',siteID:process.env.NETLIFY_SITE_ID,token:process.env.NETLIFY_AUTH_TOKEN,consistency:'strong'});const cached=await store.get(cacheKey,{type:'json'});if(cached&&cached.version===source.version&&cached.language===code&&cached.batch===batch)return reply(200,cached)}catch(_){}
 const key=process.env.OPENAI_API_KEY;if(!key)return reply(503,{ok:false,error:'language_service_unavailable'});
 try{
  let translated={};if(Object.keys(prepared.input).length){
   const schema={type:'object',properties:Object.fromEntries(Object.keys(prepared.input).map(key=>[key,{type:'string'}])),required:Object.keys(prepared.input),additionalProperties:false};
   const res=await fetch('https://api.openai.com/v1/responses',{method:'POST',headers:{Authorization:'Bearer '+key,'Content-Type':'application/json'},signal:AbortSignal.timeout(24000),body:JSON.stringify({model:'gpt-4o-mini',temperature:0,max_output_tokens:6000,instructions:`Translate the values of the app interface dictionary into ${entry.name}, native label ${entry.native}, locale ${entry.locale}. Use natural concise interface wording and its correct writing system. Keep every key unchanged. Tokens such as __SB_0__ are immutable placeholders: copy each exactly once and unchanged, placing it where its original meaning belongs. Never translate, spell out or add numbers. Preserve emoji and the name Sense Bridge. No commentary or added facts. Return the JSON dictionary.`,input:'Return only the translated JSON dictionary:\n'+JSON.stringify(prepared.input),text:{format:{type:'json_schema',name:'interface_dictionary',strict:true,schema}}})});
   const data=await res.json();if(!res.ok)return reply(502,{ok:false,error:'translation_provider_error',providerStatus:res.status,providerCode:typeof data.error?.code==='string'?data.error.code:null});if(data.status==='incomplete')return reply(502,{ok:false,error:'translation_incomplete'});
   await recordUsage(event,context,data,{feature:'UI_TRANSLATION',uiLang:code,documentLang:'EN',accessType:'SYSTEM',model:data.model||'gpt-4o-mini'});translated=JSON.parse(extract(data));
  }
  const strings=restore(translated,prepared,selected),result={ok:true,version:source.version,language:code,batch,total,strings};memory.set(cacheKey,result);if(memory.size>128)memory.delete(memory.keys().next().value);try{if(store)await store.setJSON(cacheKey,result)}catch(_){}
  return reply(200,result);
 }catch(error){return reply(502,{ok:false,error:error.message==='structure'||error.message==='protected'?'translation_structure':'language_translation_unavailable'})}
};
