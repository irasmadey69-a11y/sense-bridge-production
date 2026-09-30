const { getStore, connectLambda } = require("@netlify/blobs");
exports.handler=async(event)=>{try{
  if(event.httpMethod==="OPTIONS")return json(200,{ok:true});
  if(event.httpMethod!=="POST")return json(405,{ok:false,error:"Method not allowed"});
  try{connectLambda(event);}catch(_){ }
  const body=JSON.parse(event.body||"{}");
  const pin=String(body.adminPin||"").trim();
  if(!process.env.ADMIN_PIN||pin!==process.env.ADMIN_PIN)return json(403,{ok:false,error:"Wrong admin PIN"});
  const store=getStore({name:"sb-usage",siteID:process.env.NETLIFY_SITE_ID,token:process.env.NETLIFY_AUTH_TOKEN});
  let s={};try{const raw=await store.get("usage_summary_v1");s=raw?JSON.parse(raw):{};}catch(_){s={};}
  return json(200,{ok:true,summary:s||{}});
}catch(e){return json(500,{ok:false,error:e?.message||String(e)})}};
function json(statusCode,body){return{statusCode,headers:{"Content-Type":"application/json; charset=utf-8","Access-Control-Allow-Origin":"*","Access-Control-Allow-Headers":"Content-Type","Access-Control-Allow-Methods":"POST, OPTIONS","Cache-Control":"no-store"},body:JSON.stringify(body)}}
