const {getStore,connectLambda}=require('@netlify/blobs');
const {increment,incrementMap}=require('./_atomic-stats');
exports.handler=async(event,context)=>{try{
 if(event.httpMethod!=='POST')return json(405,{ok:false,error:'Method not allowed'});
 if(String(event.headers?.['x-sb-event']||event.headers?.['X-SB-Event']||'').toLowerCase()!=='analyze')return json(403,{ok:false,error:'Wrong event'});
 connectLambda(event);
 let body;try{body=JSON.parse(event.body||'{}');}catch{body={};}
 const lang=String(body.lang||'UNKNOWN').trim().toUpperCase().replace(/[^A-Z0-9_-]/g,'').slice(0,8)||'UNKNOWN';
 const h=event.headers||{};
 const country=String(h['x-nf-country']||h['X-Nf-Country']||context?.geo?.country?.code||'UNKNOWN').toUpperCase().replace(/[^A-Z]/g,'').slice(0,7)||'UNKNOWN';
 const store=getStore({name:'sb-stats',siteID:process.env.NETLIFY_SITE_ID,token:process.env.NETLIFY_AUTH_TOKEN});
 const count=await increment(store,'analyzes');
 if(body.combined===true){
 await increment(store,'analysis_use');
 await incrementMap(store,'geo_analysis_use',country);
 await incrementMap(store,'lang_analysis_use',lang);
 }
 return json(200,{ok:true,analyzes:count});
}catch(e){return json(500,{ok:false,error:e.message});}};
function json(statusCode,body){return {statusCode,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'},body:JSON.stringify(body)};}
