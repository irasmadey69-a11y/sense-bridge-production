const atomicStats = require('./_atomic-stats');
const { getStore, connectLambda } = require("@netlify/blobs");
exports.handler=async(event,context)=>{try{
  connectLambda(event);
  if(event.httpMethod!=="POST")return json(405,{ok:false,error:"Method not allowed"});
  if(String(event.headers?.["x-sb-event"]||event.headers?.["X-SB-Event"]||"").toLowerCase()!=="visit")return json(403,{ok:false,error:"Wrong event"});
  const body=safeJson(event.body)||{};
  const lang=normCode(body.lang||"UNKNOWN");
  const country=requestCountry(event,context);
  const store=getStore({name:"sb-stats",siteID:process.env.NETLIFY_SITE_ID,token:process.env.NETLIFY_AUTH_TOKEN});
  const count=await inc(store,"visits");
  await incrementMap(store,"geo_visits",country);
  await incrementMap(store,"lang_visits",lang);
  return json(200,{ok:true,visits:count,country,lang});
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
