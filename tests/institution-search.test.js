const {test}=require('node:test'),assert=require('node:assert/strict');
const {resolve,safeUrl,validateMatches}=require('../netlify/functions/_institution-search');
const response=(text,urls=[])=>({status:'completed',output:[...(urls.length?[{type:'web_search_call',status:'completed'}]:[]),{type:'message',content:[{type:'output_text',text,annotations:urls.map(url=>({type:'url_citation',url,title:url}))}]}]});
test('global lookup uses public names only, supports non-registry countries and provides cited official sources',async()=>{
 const doc='Kenya Revenue Authority\nPRIVATE PERSON: Jane Doe, account 123456, reference SECRET\nGhana Revenue Authority',requests=[];
 const identities=[{name:'Kenya Revenue Authority',quote:'Kenya Revenue Authority',country:'KE'},{name:'Ghana Revenue Authority',quote:'Ghana Revenue Authority',country:'GH'}];
 const items=identities.map((x,i)=>({name:x.name,country:x.country,officialWebsite:i?'https://gra.gov.gh/':'https://kra.go.ke/',corroboratingUrl:i?'https://mofep.gov.gh/agencies':'https://treasury.go.ke/agencies',confirmed:true}));
 const results=[response(JSON.stringify({institutions:identities})),response(JSON.stringify({institutions:identities.map(x=>({name:x.name,officialQuery:x.name+' official',corroborationQuery:x.name+' ministry'}))})),...items.flatMap(x=>[response('Official identity.',[x.officialWebsite]),response('Independent ministry confirms domain.',[x.corroboratingUrl])]),response(JSON.stringify({institutions:items}))];
 const found=await resolve({key:'test',text:doc,fetcher:async(u,o)=>{requests.push(JSON.parse(o.body));return{ok:true,json:async()=>results.shift()}}});
 assert.equal(found.status,'verified');assert.deepEqual(found.institutions.map(x=>x.country),['KE','GH']);assert.equal(requests.length,7);assert.equal(requests[0].tools,undefined);assert.equal(requests[1].tools,undefined);assert.equal(requests[2].tool_choice,'required');assert.doesNotMatch(JSON.stringify(requests[1]),/Jane Doe|123456|SECRET/);assert.equal(found.institutions[0].sources.length,2);assert.equal(requests[6].tools,undefined);assert.doesNotMatch(JSON.stringify(requests.slice(1)),/Jane Doe|123456|SECRET/);
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

test('Japanese research plans native and ministry queries and accepts only actually retrieved corroboration',async()=>{
 const name='国税庁',requests=[];
 const item={name,country:'JP',officialWebsite:'https://www.nta.go.jp/',corroboratingUrl:'https://www.mof.go.jp/about_mof/',confirmed:true};
 const responses=[response(JSON.stringify({institutions:[{name,quote:name,country:'JP'}]})),response(JSON.stringify({institutions:[{name,officialQuery:'国税庁 公式サイト',corroborationQuery:'国税庁 財務省 リンク'}]})),response('国税庁 official domain.',[item.officialWebsite]),response('Ministry links to the National Tax Agency.',[item.corroboratingUrl]),response(JSON.stringify({institutions:[item]}))];
 const found=await resolve({key:'test',text:'国税庁 — 日本\nPRIVATE CASE SECRET',fetcher:async(u,o)=>{requests.push(JSON.parse(o.body));return{ok:true,json:async()=>responses.shift()}}});
 assert.equal(found.institutions[0].officialWebsite,item.officialWebsite);assert.equal(found.institutions[0].country,'JP');assert.match(requests[3].input[1].content,/財務省/);assert.doesNotMatch(JSON.stringify(requests.slice(1)),/PRIVATE CASE|SECRET/);
});

test('one failed query does not discard independently corroborated results from another query',async()=>{
 const name='Федеральная налоговая служба',item={name,country:'RU',officialWebsite:'https://www.nalog.gov.ru/',corroboratingUrl:'https://minfin.gov.ru/ru/about/structure/',confirmed:true};
 const responses=[response(JSON.stringify({institutions:[{name,quote:name,country:'RU'}]})),response(JSON.stringify({institutions:[{name,officialQuery:name+' официальный сайт',corroborationQuery:name+' Минфин'}]})),new Error('one query offline'),response('Ministry identifies the tax agency and links its official site.',[item.officialWebsite,item.corroboratingUrl]),response(JSON.stringify({institutions:[item]}))];
 const found=await resolve({key:'test',text:name+'\nРоссийская Федерация',fetcher:async()=>{const next=responses.shift();if(next instanceof Error)throw next;return {ok:true,json:async()=>next};}});
 assert.equal(found.status,'verified');assert.equal(found.institutions[0].officialWebsite,item.officialWebsite);
});
test('failed query planning falls back to public-name searches rather than cancelling lookup',async()=>{
 const name='Revenue Authority',item={name,country:'KE',officialWebsite:'https://kra.go.ke/',corroboratingUrl:'https://treasury.go.ke/agencies',confirmed:true};
 const responses=[response(JSON.stringify({institutions:[{name,quote:name,country:''}]})),new Error('planner offline'),response('Official identity',[item.officialWebsite]),response('Ministry corroborates',[item.corroboratingUrl]),response(JSON.stringify({institutions:[item]}))];
 const found=await resolve({key:'test',text:name,fetcher:async()=>{const next=responses.shift();if(next instanceof Error)throw next;return {ok:true,json:async()=>next};}});
 assert.equal(found.status,'verified');assert.equal(found.institutions[0].country,'KE');
});
test('lookup has a real deadline even when the provider ignores cancellation',async()=>{
 const started=Date.now();
 const found=await resolve({key:'test',text:'Revenue Authority',timeoutMs:30,fetcher:()=>new Promise(()=>{})});
 assert.equal(found.status,'unavailable');assert.equal(found.reason,'timeout');assert.ok(Date.now()-started<1000);
});
test('shared government hosting preserves an agency path rather than a generic homepage',()=>{
 const name='HMRC',item={name,country:'GB',officialWebsite:'https://www.gov.uk/government/organisations/hm-revenue-customs',corroboratingUrl:'https://www.parliament.uk/hmrc',confirmed:true};
 const matches=validateMatches([item],[{name}],response('The official agency page is identified.',[item.officialWebsite,item.corroboratingUrl]));
 assert.equal(matches[0].officialWebsite,item.officialWebsite);
});
