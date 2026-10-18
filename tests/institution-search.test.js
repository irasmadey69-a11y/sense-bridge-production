const {test}=require('node:test'),assert=require('node:assert/strict');
const {resolve,safeUrl,validateMatches}=require('../netlify/functions/_institution-search');
const response=(text,urls=[])=>({status:'completed',output:[...(urls.length?[{type:'web_search_call',status:'completed'}]:[]),{type:'message',content:[{type:'output_text',text,annotations:urls.map(url=>({type:'url_citation',url,title:url}))}]}]});
test('global lookup uses public names only, supports non-registry countries and provides cited official sources',async()=>{
 const doc='Kenya Revenue Authority\nPRIVATE PERSON: Jane Doe, account 123456, reference SECRET\nGhana Revenue Authority',requests=[];
 const identities=[{name:'Kenya Revenue Authority',quote:'Kenya Revenue Authority',country:'KE'},{name:'Ghana Revenue Authority',quote:'Ghana Revenue Authority',country:'GH'}];
 const items=identities.map((x,i)=>({name:x.name,country:x.country,officialWebsite:i?'https://gra.gov.gh/':'https://kra.go.ke/',corroboratingUrl:i?'https://mofep.gov.gh/agencies':'https://treasury.go.ke/agencies',confirmed:true}));
 const results=[response(JSON.stringify({institutions:identities})),response(JSON.stringify({institutions:items}),items.flatMap(x=>[x.officialWebsite,x.corroboratingUrl]))];
 const found=await resolve({key:'test',text:doc,fetcher:async(u,o)=>{requests.push(JSON.parse(o.body));return{ok:true,json:async()=>results.shift()}}});
 assert.equal(found.status,'verified');assert.deepEqual(found.institutions.map(x=>x.country),['KE','GH']);assert.equal(requests.length,2);assert.equal(requests[0].tools,undefined);assert.equal(requests[1].tool_choice,'required');assert.doesNotMatch(JSON.stringify(requests[1]),/Jane Doe|123456|SECRET/);assert.equal(found.institutions[0].sources.length,2);
});
test('uncited or self-corroborating domains and unconfirmed identities fail closed',()=>{
 const identities=[{name:'Authority'}],item={name:'Authority',country:'JP',officialWebsite:'https://official.go.jp/',corroboratingUrl:'https://directory.go.jp/authority',confirmed:true};
 for(const change of [{}, {confirmed:false},{officialWebsite:'https://official.go.jp.attacker.example/'},{corroboratingUrl:'https://official.go.jp/about'}])assert.deepEqual(validateMatches([{...item,...change}],identities,response('{}',[item.officialWebsite])),[]);
 assert.deepEqual(validateMatches([item],identities,response('{}',[item.officialWebsite])),[]);
 assert.equal(validateMatches([item],identities,response('{}',[item.officialWebsite,item.corroboratingUrl])).length,1);
});
test('reserved domains, credentials, IPs, local addresses and non-HTTPS are rejected',()=>{
 for(const url of ['javascript:alert(1)','http://official.gov','https://a.example','https://127.0.0.1/','https://[::1]/','https://user:pass@example.com/','https://localhost/','https://a.internal/','https://official.gov:8080/'])assert.equal(safeUrl(url),'');
 assert.equal(safeUrl('https://www.gov.za/'),'https://www.gov.za/');
});
test('invented identities cannot be searched; provider outage produces explicit unavailable status',async()=>{
 let calls=0;
 const result=await resolve({key:'test',text:'A private letter',fetcher:async()=>{calls++;return{ok:true,json:async()=>response(JSON.stringify({institutions:[{name:'Made up Authority',quote:'Made up Authority',country:'ZA'}]}))}}});
 assert.equal(calls,1);assert.equal(result.status,'unidentified');
 assert.equal((await resolve({key:'test',text:'Authority',fetcher:async()=>{throw Error('offline')}})).status,'unavailable');
});
