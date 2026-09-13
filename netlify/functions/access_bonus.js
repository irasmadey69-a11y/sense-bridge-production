const { getStore, connectLambda } = require("@netlify/blobs");
exports.handler = async (event) => {
  const method = String(event?.httpMethod || "").toUpperCase();
  if (method === "OPTIONS") return json(200,{ok:true});
  if (method !== "POST") return json(405,{ok:false,error:"Method not allowed"});
  try {
    connectLambda(event);
    const body = safeJson(event.body);
    if (!body) return json(400,{ok:false,error:"Invalid JSON body"});
    const email = String(body.email || "").trim().toLowerCase();
    const adminPin = String(body.adminPin || "");
    if (!email || !email.includes("@")) return json(400,{ok:false,error:"Missing email"});
    if (!process.env.ADMIN_PIN || adminPin !== process.env.ADMIN_PIN) return json(403,{ok:false,error:"Wrong admin PIN"});
    const users = getStore({name:"sb-users",siteID:process.env.NETLIFY_SITE_ID,token:process.env.NETLIFY_AUTH_TOKEN});
    const stats = getStore({name:"sb-stats",siteID:process.env.NETLIFY_SITE_ID,token:process.env.NETLIFY_AUTH_TOKEN});
    const now = Date.now();
    const raw = await users.get(email);
    const existing = raw ? safeJson(raw) : {};
    const status = String(existing?.status || "NONE").toUpperCase();
    if (status === "BLOCKED") return json(403,{ok:false,error:"Ten email jest zablokowany."});
    const bonusUsesGranted = Math.max(0,Number(existing?.bonusUsesGranted)||0) + 3;
    const bonusGrantCount = Math.max(0,Number(existing?.bonusGrantCount)||0) + 1;
    const timedActive = Number(existing?.expires) > now && ["ACTIVE","BETA"].includes(status);
    const nextStatus = timedActive ? status : "BONUS";
    const userData = {...(existing&&typeof existing==="object"?existing:{}),email,status:nextStatus,bonusUsesGranted,bonusGrantCount,bonusGrantedAt:now,createdAt:existing?.createdAt||now,last:"Przyznano +3 użycia"};
    await users.set(email,JSON.stringify(userData));
    await inc(stats,"access_grant_3"); await inc(stats,"access_granted");
    await incrementMap(stats,"geo_access_grant_3",existing?.requestCountry||"UNKNOWN");
    await incrementMap(stats,"lang_access_grant_3",existing?.requestLang||"UNKNOWN");
    return json(200,{ok:true,email,status:nextStatus,bonusUsesGranted,bonusGrantCount,requestCount:Math.max(0,Number(userData.requestCount)||0)});
  } catch(e){console.error("access_bonus error:",e);return json(500,{ok:false,error:e?.message||String(e)});}
};
async function inc(store,key){const raw=await store.get(key);const n=raw?parseInt(raw,10):0;const next=Number.isFinite(n)?n+1:1;await store.set(key,String(next));return next;}
function safeJson(v){try{if(v&&typeof v==="object")return v;return JSON.parse(v||"{}");}catch{return null;}}

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
async function incrementMap(store,key,label){
  const raw=await store.get(key);
  let map={};
  try{ map=raw?JSON.parse(raw):{}; }catch(_){ map={}; }
  if(!map || typeof map!=="object" || Array.isArray(map)) map={};
  const k=normCode(label);
  map[k]=Math.max(0,Number(map[k])||0)+1;
  await store.set(key,JSON.stringify(map));
  return map[k];
}
async function readMap(store,key){
  const raw=await store.get(key);
  try{ const v=raw?JSON.parse(raw):{}; return v&&typeof v==="object"&&!Array.isArray(v)?v:{}; }catch(_){ return {}; }
}

function json(statusCode,obj){return{statusCode,headers:{"Content-Type":"application/json; charset=utf-8","Access-Control-Allow-Origin":"*","Access-Control-Allow-Headers":"Content-Type","Access-Control-Allow-Methods":"POST, OPTIONS","Cache-Control":"no-store"},body:JSON.stringify(obj)}}
