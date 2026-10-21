const catalog=require('./_world-catalog.json');
const locales=[...new Set(['en',...Object.values(catalog.languages).map(x=>x.locale).filter(Boolean)])];
function countrySupported(code,text){
 if(!/^[A-Z]{2}$/.test(code||''))return false;
 const clean=String(text||'').replace(/(?:https?:\/\/|www\.)\S+/giu,'');
 const names=[];
 for(const locale of locales)try{
  const name=new Intl.DisplayNames([locale],{type:'region'}).of(code);
  if(name&&name!==code)names.push(name);
 }catch{}
 if(code==='RU')names.push('Российская Федерация','Российской Федерации','РФ','Russia','Rusland');
 return names.some(name=>new RegExp('(?:^|[^\\p{L}\\p{N}])'+name.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')+'(?:$|[^\\p{L}\\p{N}])','iu').test(clean));
}
module.exports={countrySupported};
