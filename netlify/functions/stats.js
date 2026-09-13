const { getStore } = require("@netlify/blobs");
exports.handler=async(event)=>{try{
  if(event.httpMethod!=="POST")return json(405,{ok:false,error:"Method not allowed"});
  const body=JSON.parse(event.body||"{}"); const adminPin=String(body.adminPin||"");
  if(!process.env.ADMIN_PIN||adminPin!==process.env.ADMIN_PIN)return json(403,{ok:false,error:"Wrong admin PIN"});
  const store=getStore({name:"sb-stats",siteID:process.env.NETLIFY_SITE_ID,token:process.env.NETLIFY_AUTH_TOKEN});
  const keys=["visits","analyzes","app_open","shortcut_add","ocr_use","return_user","analysis_use","access_request","access_request_unique","access_info_open","free_limit_reached","access_grant_3","access_grant_time","access_granted","ai_screenshot","ai_link","ai_message","ai_reply","ai_conversation","ai_contract","ai_doc_pdf","ai_doc_form","ai_doc_photo","ai_doc_bill","ai_doc_unknown","ai_error"];
  const vals={}; await Promise.all(keys.map(async k=>{vals[k]=await getCount(store,k)}));
  const breakEvents=["visits","app_open","analysis_use","access_info_open","free_limit_reached","access_request","access_grant_3","access_grant_time"];
  const country={},language={};
  await Promise.all(breakEvents.flatMap(ev=>[
    readMap(store,"geo_"+ev).then(v=>country[ev]=v),
    readMap(store,"lang_"+ev).then(v=>language[ev]=v)
  ]));
  return json(200,{ok:true,
    visits:vals.visits,analyzes:vals.analyzes,appOpens:vals.app_open,shortcutAdds:vals.shortcut_add,ocrUses:vals.ocr_use,returnUsers:vals.return_user,
    analysisUses:vals.analysis_use,accessRequests:vals.access_request,uniqueAccessRequesters:vals.access_request_unique,accessInfoOpens:vals.access_info_open,freeLimitReached:vals.free_limit_reached,
    accessGrant3:vals.access_grant_3,accessGrantTime:vals.access_grant_time,accessGranted:vals.access_granted,
    aiScreenshot:vals.ai_screenshot,aiLink:vals.ai_link,aiMessage:vals.ai_message,aiReply:vals.ai_reply,aiConversation:vals.ai_conversation,aiContract:vals.ai_contract,
    aiDocPdf:vals.ai_doc_pdf,aiDocForm:vals.ai_doc_form,aiDocPhoto:vals.ai_doc_photo,aiDocBill:vals.ai_doc_bill,aiDocUnknown:vals.ai_doc_unknown,aiErrors:vals.ai_error,
    breakdown:{country,language}
  });
}catch(e){return json(500,{ok:false,error:e.message})}};
async function getCount(store,key){const raw=await store.get(key);const n=raw?parseInt(raw,10):0;return Number.isFinite(n)?n:0;}

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

function json(statusCode,body){return{statusCode,headers:{"Content-Type":"application/json; charset=utf-8","Cache-Control":"no-store"},body:JSON.stringify(body)}}
