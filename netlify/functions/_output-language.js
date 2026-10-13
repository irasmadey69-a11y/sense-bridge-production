const { name } = require('./_ai-languages');
const countries=Object.fromEntries(Object.entries(require('./_world-catalog.json').languages).map(([key,value])=>[key,value.countries]));
const overrides = {PT:{BR:'Brazilian Portuguese',PT:'European Portuguese'},EN:{AQ:'Standard English',HM:'Standard English',GB:'British English',US:'American English',CA:'Canadian English',AU:'Australian English',NZ:'New Zealand English',IE:'Irish English'},FR:{CA:'Canadian French',FR:'French as used in France',BE:'Belgian French',CH:'Swiss French'},DE:{DE:'Standard German as used in Germany',AT:'Austrian Standard German',CH:'Swiss Standard German'},ES:{ES:'Spanish as used in Spain',MX:'Mexican Spanish',AR:'Argentinian Spanish',CO:'Colombian Spanish',CL:'Chilean Spanish'},NL:{NL:'Dutch as used in the Netherlands',BE:'Belgian Dutch'},ZH:{CN:'Simplified Chinese as used in mainland China',TW:'Traditional Chinese as used in Taiwan',HK:'Traditional Chinese as used in Hong Kong',MO:'Traditional Chinese as used in Macao'},AR:{EG:'Modern Standard Arabic as used in Egypt'},EG:{EG:'Egyptian Arabic'}};
function target(language,region){
 const lang=typeof language==='string'?language.trim().toUpperCase():'';
 const code=typeof region==='string'?region.trim().toUpperCase():'';
 const selected=/^[A-Z]{2}$/.test(code)&&countries[lang]&&countries[lang].includes(code)?code:'';
 let label=name(lang);
 if(selected){let country=selected;try{country=new Intl.DisplayNames(['en'],{type:'region'}).of(selected)||selected}catch(_){}label=(overrides[lang]||{})[selected]||label+' as used in '+country;}
 return {language:lang,region:selected,label};
}
function instruction(language,region){
 const t=target(language,region);if(!t.region)return '';
 return `OUTPUT LANGUAGE VARIANT: Write user-facing explanations and translations into the user's language in ${t.label}. Use its natural spelling, vocabulary, grammar and appropriate written conventions. This is an output-language choice only. It is not evidence of the document country, jurisdiction, user's residence or work country. Determine those facts only from the supplied document or verified evidence. Preserve meaning, legal names, institutions, URLs, account numbers, reference codes, dates, amounts and currencies; do not convert or reinterpret them. Do not apply this choice to replies explicitly requested in the document or recipient's language. Keep JSON keys, language codes and risk classifications unchanged.`;
}
exports.target=target;
exports.instruction=instruction;
exports.countries=countries;
