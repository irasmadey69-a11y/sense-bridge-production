const {test}=require('node:test'),assert=require('node:assert/strict');
const {verify,validate}=require('../netlify/functions/_institution-portals');
const institution={name:'Hospital ABC',officialWebsite:'https://hospital.gov.it/'};
const portal={institutionName:institution.name,host:'patient.gov.it',sourceUrl:'https://hospital.gov.it/patients',confirmed:true};
function response(items=[portal],urls=[portal.sourceUrl,'https://patient.gov.it/']){return {status:'completed',output:[{type:'web_search_call',status:'completed',action:{sources:urls.map(url=>({url}))}},{type:'message',content:[{type:'output_text',text:JSON.stringify({portals:items})}]}]};}
test('portal relationship requires retrieved official linking page and retrieved exact candidate host',()=>{
 assert.equal(validate(response(),institution,[portal.host]).length,1);
 for(const item of [{...portal,confirmed:false},{...portal,sourceUrl:'https://patient.gov.it/about'},{...portal,sourceUrl:'https://hospital.gov.it.evil.example/about'},{...portal,institutionName:'Other Hospital'},{...portal,host:'other.gov.it'}])assert.deepEqual(validate(response([item]),institution,[portal.host]),[]);
 assert.deepEqual(validate(response([portal],['https://patient.gov.it/']),institution,[portal.host]),[]);
 assert.deepEqual(validate(response([portal],[portal.sourceUrl]),institution,[portal.host]),[]);
});
test('portal check sends public hostnames only, never paths, tokens or the letter',async()=>{
 let request;
 const found=await verify({key:'test',institution,links:['https://patient.gov.it/person/SECRET?token=PRIVATE','https://hospital.gov.it/'],fetcher:async(u,o)=>{request=JSON.parse(o.body);return {ok:true,json:async()=>response()};}});
 assert.equal(found.length,1);assert.doesNotMatch(JSON.stringify(request),/SECRET|PRIVATE|token=|\/person/);assert.match(request.input[1].content,/patient.gov.it/);
});
test('portal check deadline and failures preserve the available analysis',async()=>{
 assert.deepEqual(await verify({key:'test',institution,links:['https://patient.gov.it/'],timeoutMs:15,fetcher:()=>new Promise(()=>{})}),[]);
 assert.deepEqual(await verify({key:'test',institution,links:['https://patient.gov.it/'],fetcher:async()=>{throw Error('offline');}}),[]);
});
