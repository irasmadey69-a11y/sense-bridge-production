const directThreatKinds=new Set(['SECRET_DISCLOSURE','MALWARE','EXTORTION','ADVANCE_FEE']);
function normalize(value){return String(value||'').normalize('NFKC').replace(/[’‘]/g,"'").replace(/\s+/gu,' ').trim();}
function supported(source,quote){const q=normalize(quote);return !!q&&normalize(source).includes(q);}
function hostname(value){try{return new URL(value).hostname.toLowerCase().replace(/^www\./,'');}catch{return '';}}
function linkedHosts(quote){return (String(quote).match(/https?:\/\/[^\s<>"“”]+/giu)||[]).map(x=>hostname(x.replace(/[.,;!?)]+$/u,''))).filter(Boolean);}
function adjudicate(candidate,source,options={}){
 const original=candidate.fraudRisk||{},findings=Array.isArray(original.findings)?original.findings:[];
 const hosts=[...(options.verifiedHosts||[]),...(candidate.institution?.relatedOfficialHosts||[])];
 if(candidate.verifiedInstitution&&candidate.institution?.officialWebsite)hosts.push(hostname(candidate.institution.officialWebsite));
 const valid=findings.filter(x=>x&&supported(source,x.quote)&&String(x.explanation||'').trim());
 const concerns=valid.filter(x=>x.polarity==='AFFIRMATIVE'&&(x.severity!=='LOW'||directThreatKinds.has(x.kind))).filter(x=>{
  if(x.kind!=='DECEPTIVE_LINK')return true;
  const links=linkedHosts(x.quote);
  return !links.length||!links.every(h=>hosts.some(v=>h===v||h.endsWith('.'+v)));
 });
 const strong=concerns.filter(x=>directThreatKinds.has(x.kind)||x.severity==='HIGH'&&!['PAYMENT_REQUEST','IDENTITY_UNCERTAINTY'].includes(x.kind));
 const medium=concerns.filter(x=>x.severity==='MEDIUM'||x.severity==='HIGH');
 let level=strong.length?'HIGH':medium.length?'MEDIUM':['UNKNOWN','HIGH','MEDIUM'].includes(original.level)&&!findings.length?'UNKNOWN':'LOW';
 if(findings.length!==valid.length&&!medium.length||options.incomplete&&level==='LOW')level='UNKNOWN';
 const deciding=level==='HIGH'?strong:level==='MEDIUM'?medium:[];
 const unique=items=>[...new Set(items.map(x=>String(x||'').trim()).filter(Boolean))];
 const summary=deciding.length?unique(deciding.map(x=>x.explanation)).join(' '):level===original.level?String(original.summary||''):'';
 const requiresVerification=level==='MEDIUM'||findings.length!==valid.length||level==='UNKNOWN'&&['HIGH','MEDIUM'].includes(original.level);
 const assessment={version:2,level,requiresVerification,findings:valid,verification:options.verification||'unverified',unsupportedFindings:findings.length-valid.length};
 candidate.fraudRisk={...original,level,confidence:0,label:options.label?options.label(level):level===original.level?original.label:'',summary:summary||(options.label?options.label(level):''),signals:unique(deciding.map(x=>x.explanation)),suspiciousElements:unique(deciding.map(x=>x.quote)),findings:valid,safeSteps:level==='HIGH'?(original.level==='HIGH'&&Array.isArray(original.safeSteps)&&original.safeSteps.length?original.safeSteps.filter(step=>linkedHosts(step).every(h=>hosts.some(v=>h===v||h.endsWith('.'+v)))):options.safeSteps?options.safeSteps():[]):[],assessmentVersion:2};
 if(requiresVerification&&level!=='HIGH')candidate.fraudRisk.safeSteps=options.safeSteps?[options.safeSteps()[2]]:[];
 candidate.riskAssessment=assessment;
 // Source URLs remain visible in translation; unverified destinations are not actionable advice.
 const guidance=options.safeSteps?options.safeSteps()[2]:'';
 const unverifiedAuthentication=linkedHosts(source).some(h=>!hosts.some(v=>h===v||h.endsWith('.'+v)))&&valid.some(x=>x.kind==='LOGIN'&&x.polarity==='AFFIRMATIVE');
 const authenticationQuotes=unverifiedAuthentication?valid.filter(x=>x.kind==='LOGIN'&&x.polarity==='AFFIRMATIVE').map(x=>x.quote):[];
 const authAction=action=>(action.quotes||[]).some(q=>authenticationQuotes.some(login=>supported(q,login)||supported(login,q)));
 if(unverifiedAuthentication&&guidance)candidate.help=[guidance];
 if(level!=='HIGH'&&guidance&&Array.isArray(candidate.actions))candidate.actions=candidate.actions.map(action=>authAction(action)||linkedHosts(action.text).some(h=>!hosts.some(v=>h===v||h.endsWith('.'+v)))?{...action,text:guidance}:action).filter((action,i,all)=>all.findIndex(x=>x.text===action.text)===i);
 candidate.suspiciousLinks=level==='HIGH'?candidate.suspiciousLinks:[];
 delete candidate.securityAdvice;
 if(level==='HIGH')candidate.replyIntent='NO_REPLY';
 return assessment;
}
module.exports={adjudicate,supported,hostname};
