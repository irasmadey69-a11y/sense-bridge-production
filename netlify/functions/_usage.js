// Sense Bridge usage & cost telemetry v1
// Stores only aggregate metadata. Never stores document text, images or AI output.
const { getStore, connectLambda } = require("@netlify/blobs");

const PRICE_USD_PER_MTOK = {
  "gpt-4o-mini": { input: 0.15, output: 0.60 },
  "gpt-4o-mini-2024-07-18": { input: 0.15, output: 0.60 },
  "gpt-4.1-mini": { input: 0.40, output: 1.60 },
  "gpt-4.1-mini-2025-04-14": { input: 0.40, output: 1.60 }
};

function norm(v, fallback="UNKNOWN", max=40){
  const s=String(v ?? "").trim().toUpperCase().replace(/[^A-Z0-9_.:+-]/g, "_");
  return s ? s.slice(0,max) : fallback;
}
function geoCountry(event, context){
  const h=event?.headers||{};
  return norm(h["x-nf-country"]||h["X-Nf-Country"]||h["x-country"]||h["X-Country"]||h["cf-ipcountry"]||h["CF-IPCountry"]||event?.geo?.country?.code||context?.geo?.country?.code||"UNKNOWN","UNKNOWN",8);
}
function usageOf(data){
  const u=data?.usage||{};
  const input=Number(u.input_tokens ?? u.prompt_tokens ?? 0)||0;
  const output=Number(u.output_tokens ?? u.completion_tokens ?? 0)||0;
  return {inputTokens:Math.max(0,input),outputTokens:Math.max(0,output)};
}
function estimate(model,inputTokens,outputTokens){
  const m=String(model||"").toLowerCase();
  const p=PRICE_USD_PER_MTOK[m] || (m.startsWith("gpt-4.1-mini")?PRICE_USD_PER_MTOK["gpt-4.1-mini"]:PRICE_USD_PER_MTOK["gpt-4o-mini"]);
  return ((inputTokens*p.input)+(outputTokens*p.output))/1_000_000;
}
function newBucket(){return {calls:0,inputTokens:0,outputTokens:0,costUsd:0};}
function addBucket(map,key,input,output,cost){
  key=norm(key);
  const b=(map[key]&&typeof map[key]==="object")?map[key]:newBucket();
  b.calls=(Number(b.calls)||0)+1;
  b.inputTokens=(Number(b.inputTokens)||0)+input;
  b.outputTokens=(Number(b.outputTokens)||0)+output;
  b.costUsd=+(Number(b.costUsd||0)+cost).toFixed(8);
  map[key]=b;
}
function dayKey(ts){return new Date(ts).toISOString().slice(0,10);}
function pruneDays(obj,keep=120){
  const keys=Object.keys(obj||{}).sort();
  while(keys.length>keep){ delete obj[keys.shift()]; }
}

async function recordUsage(event, context, data, meta={}){
  try{
    try{ connectLambda(event); }catch(_){ }
    const {inputTokens,outputTokens}=usageOf(data);
    const model=String(meta.model||data?.model||"gpt-4o-mini");
    const cost=estimate(model,inputTokens,outputTokens);
    const now=Date.now();
    const store=getStore({name:"sb-usage",siteID:process.env.NETLIFY_SITE_ID,token:process.env.NETLIFY_AUTH_TOKEN});
    const key="usage_summary_v1";
    let summary={};
    try{const raw=await store.get(key);summary=raw?JSON.parse(raw):{};}catch(_){summary={};}
    if(!summary||typeof summary!=="object"||Array.isArray(summary))summary={};
    summary.version=1;
    summary.since=summary.since||now;
    summary.updatedAt=now;
    summary.pricing={currency:"USD",source:"OpenAI public API pricing",gpt4oMini:{inputPerM:0.15,outputPerM:0.60},gpt41Mini:{inputPerM:0.40,outputPerM:1.60}};
    summary.totalCalls=(Number(summary.totalCalls)||0)+1;
    summary.inputTokens=(Number(summary.inputTokens)||0)+inputTokens;
    summary.outputTokens=(Number(summary.outputTokens)||0)+outputTokens;
    summary.estimatedCostUsd=+(Number(summary.estimatedCostUsd||0)+cost).toFixed(8);
    for(const k of ["byFeature","byCountry","byUiLang","byDocumentLang","byAccessType","byModel","byDay"]){ if(!summary[k]||typeof summary[k]!=="object"||Array.isArray(summary[k]))summary[k]={}; }
    const country=meta.country||geoCountry(event,context);
    addBucket(summary.byFeature,meta.feature||"UNKNOWN",inputTokens,outputTokens,cost);
    addBucket(summary.byCountry,country,inputTokens,outputTokens,cost);
    addBucket(summary.byUiLang,meta.uiLang||"UNKNOWN",inputTokens,outputTokens,cost);
    addBucket(summary.byDocumentLang,meta.documentLang||"UNKNOWN",inputTokens,outputTokens,cost);
    addBucket(summary.byAccessType,meta.accessType||"UNKNOWN",inputTokens,outputTokens,cost);
    addBucket(summary.byModel,model,inputTokens,outputTokens,cost);
    addBucket(summary.byDay,dayKey(now),inputTokens,outputTokens,cost);
    pruneDays(summary.byDay,120);
    await store.set(key,JSON.stringify(summary));
    return {ok:true,costUsd:cost,inputTokens,outputTokens};
  }catch(e){
    console.error("usage telemetry error:",e);
    return {ok:false,error:e?.message||String(e)};
  }
}
module.exports={recordUsage,usageOf,estimate,PRICE_USD_PER_MTOK};
