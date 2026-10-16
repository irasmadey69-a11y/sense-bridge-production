// Preserve the existing keys, but avoid lost updates from concurrent requests.
// Requires @netlify/blobs >=10.5 (pinned in package.json).
async function mutateText(store,key,update) {
  if(typeof store.getWithMetadata!=='function')throw new Error('Conditional storage API unavailable');
  for(let attempt=0;attempt<32;attempt++) {
    const current=await store.getWithMetadata(key,{type:'text',consistency:'strong'});
    const next=update(current?.data??null);
    if(typeof next!=='string')throw new Error('Invalid statistics update');
    const options=current?{onlyIfMatch:current.etag}:{onlyIfNew:true};
    if(current&&!current.etag)throw new Error('Missing storage ETag');
    const result=await store.set(key,next,options);
    if(result?.modified===true)return next;
    if(result?.modified!==false)throw new Error('Unconfirmed statistics write');
    await new Promise(resolve=>setTimeout(resolve,5+Math.floor(Math.random()*20)));
  }
  throw new Error('Statistics update conflict; no overwrite performed');
}
async function increment(store,key){
  return Number(await mutateText(store,key,raw=>String(Math.max(0,parseInt(raw||'0',10)||0)+1)));
}
async function incrementMap(store,key,label){
  const k=String(label||'UNKNOWN').trim().toUpperCase().replace(/[^A-Z0-9_-]/g,'').slice(0,8)||'UNKNOWN';
  const value=await mutateText(store,key,raw=>{
    let map;try{map=JSON.parse(raw||'{}');}catch{map={};}
    if(!map||typeof map!=='object'||Array.isArray(map))map={};
    map[k]=Math.max(0,Number(map[k])||0)+1;
    return JSON.stringify(map);
  });
  return JSON.parse(value)[k];
}
module.exports={mutateText,increment,incrementMap};
