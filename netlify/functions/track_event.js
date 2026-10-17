const atomicStats = require('./_atomic-stats');
const { getStore, connectLambda } = require("@netlify/blobs");
const ALLOWED_EVENTS=[
  "app_open","shortcut_add","shortcut_click","ocr_use","return_user","analysis_use","access_request","access_info_open","free_limit_reached",
  "ai_screenshot","ai_link","ai_message","ai_reply","ai_conversation","ai_contract","ai_doc_pdf","ai_doc_form","ai_doc_photo","ai_doc_bill","ai_doc_exercise","ai_doc_options","ai_doc_question","ai_doc_job","ai_job_ask","ai_job_apply","ai_job_conversation","ai_doc_unknown","ai_error","analysis_error"
];
exports.handler=async(event,context)=>{try{
  connectLambda(event);
  if(event.httpMethod!=="POST")return json(405,{ok:false,error:"Method not allowed"});
  const body=safeJson(event.body)||{}; const eventName=String(body.event||"").trim();
  if(!ALLOWED_EVENTS.includes(eventName))return json(400,{ok:false,error:"Unknown event"});
  const lang=normCode(body.lang||"UNKNOWN"); const country=requestCountry(event,context);
  const store=getStore({name:"sb-stats",siteID:process.env.NETLIFY_SITE_ID,token:process.env.NETLIFY_AUTH_TOKEN});
  const count=await inc(store,eventName);
  await incrementMap(store,"geo_"+eventName,country);
  await incrementMap(store,"lang_"+eventName,lang);
  return json(200,{ok:true,event:eventName,count,country,lang});
}catch(e){return json(500,{ok:false,error:e.message})}};
async function inc(store,key){return atomicStats.increment(store,key);}
function safeJson(v){try{return v?JSON.parse(v):{}}catch{return {}}}

function normCode(v, maxLen=8){
  const s=String(v||"").trim().toUpperCase().replace(/[^A-Z0-9_-]/g,"");
  return s && s.length<=maxLen ? s : "UNKNOWN";
}
function requestCountry(event, context){
  const h=event?.headers||{};
  return normCode(
    h["x-nf-country"] || h["X-Nf-Country"] || h["x-country"] || h["X-Country"] ||
    h["cf-ipcountry"] || h["CF-IPCountry"] || event?.geo?.country?.code || context?.geo?.country?.code || "UNKNOWN",
    4
  );
}
async function incrementMap(store,key,label){return atomicStats.incrementMap(store,key,label);}
async function readMap(store,key){
  const raw=await store.get(key);
  try{ const v=raw?JSON.parse(raw):{}; return v&&typeof v==="object"&&!Array.isArray(v)?v:{}; }catch(_){ return {}; }
}

function json(statusCode,body){return{statusCode,headers:{"Content-Type":"application/json; charset=utf-8"},body:JSON.stringify(body)}}
