const checkedAt = '2026-09-30';
const rows = [
  { country: 'NL', from: '2026-01-01', until: '2026-06-30', unit: 'hour', currency: 'EUR', ages: {15:4.41,16:5.07,17:5.81,18:7.36,19:8.83,20:11.77,21:14.71}, adult:21, source:'https://www.government.nl/themes/work/minimum-wage/minimum-wage-amounts' },
  { country: 'NL', from: '2026-07-01', until: '2026-12-31', unit: 'hour', currency: 'EUR', ages: {15:4.50,16:5.17,17:5.92,18:7.50,19:8.99,20:11.99,21:14.99}, adult:21, source:'https://www.government.nl/themes/work/minimum-wage/minimum-wage-amounts' },
  { country: 'DE', from: '2026-01-01', until: '2026-12-31', unit: 'hour', currency:'EUR', ages:{18:13.90}, adult:18, source:'https://www.bmas.de/DE/Arbeit/Arbeitsrecht/Mindestlohn/mindestlohn.htm' },
  { country: 'GB', from:'2026-04-01', until:'2027-03-31', unit:'hour', currency:'GBP', ages:{18:10.85,19:10.85,20:10.85,21:12.71}, adult:21, source:'https://www.gov.uk/national-minimum-wage-rates' },
  { country: 'FR', from:'2026-06-01', until:'2026-10-31', unit:'hour', currency:'EUR', ages:{18:12.31}, adult:18, source:'https://www.service-public.gouv.fr/particuliers/vosdroits/F2300' },
  { country: 'PL', from:'2026-01-01', until:'2026-12-31', unit:'month', currency:'PLN', ages:{18:4806}, adult:18, source:'https://www.gov.pl/web/rodzina/minimalne-wynagrodzenie-za-prace' },
  { country: 'BE', from:'2026-07-01', until:'2026-10-31', unit:'month', currency:'EUR', ages:{18:2233.60}, adult:18, sectorRequired:true, source:'https://www.vlaanderen.be/werken/een-buitenlander-in-vlaanderen-tewerkstellen/lonen-en-toeslagen', sectorSource:'https://minimumlonen.be/index.html?lang=nl' }
].map(row => ({...row,checkedAt}));

function numberInQuote(amount,quote){
  if(typeof amount!=='number'||!Number.isFinite(amount)||amount<=0)return false;
  return (String(quote).match(/\d[\d.,\s\u00a0]*\d|\d/g)||[]).some(token=>{
    let s=token.replace(/[\s\u00a0]/g,'');
    if(s.includes(',')&&s.includes('.'))s=s.lastIndexOf(',')>s.lastIndexOf('.')?s.replace(/\./g,'').replace(',','.'):s.replace(/,/g,'');
    else if(s.includes(','))s=s.replace(',','.');
    return Math.abs(Number(s)-amount)<0.00001;
  });
}
function compareSalary(salary,context={},text='',today=new Date().toISOString().slice(0,10)){
  const date=context.date||today;
  const country=String(context.country||'').toUpperCase();
  const age=context.age==null||context.age===''?null:Number(context.age);
  const row=rows.find(r=>r.country===country&&date>=r.from&&date<=r.until);
  const out={status:'UNAVAILABLE',reason:'reference',country,date,checkedAt};
  if(!row)return out;
  Object.assign(out,{unit:row.unit,currency:row.currency,effectiveFrom:row.from,validUntil:row.until,source:row.source,sectorSource:row.sectorSource||null});
  if(age===null||!Number.isInteger(age)||age<15||age>100)return {...out,reason:'age'};
  const minimum=row.ages[Math.min(age,row.adult)];
  if(!minimum)return {...out,reason:'age'};
  out.minimum=minimum;
  if(row.sectorRequired)return {...out,reason:'sector'};
  if(context.contract!=='employee')return {...out,reason:'contract'};
  if(row.country==='PL' && salary?.fullTime!==true)return {...out,reason:'fullTime'};
  const s=salary||{};
  if(s.basis!=='gross'||s.explicitGross!==true||s.baseOnly!==true)return {...out,reason:'grossBase'};
  if(s.currency!==row.currency)return {...out,reason:'currency'};
  if(s.unit!==row.unit)return {...out,reason:'unit'};
  const quote=String(s.quote||'').trim();
  const normalize=v=>v.replace(/\s+/g,' ').trim();
  if(!quote||!normalize(text).includes(normalize(quote))||!numberInQuote(s.min,quote))return {...out,reason:'evidence'};
  const maximum=s.max==null?s.min:s.max;
  if(maximum<s.min||!numberInQuote(maximum,quote))return {...out,reason:'evidence'};
  const round=v=>Math.round(v*100)/100;
  return {...out,status:s.min>minimum?'ABOVE':maximum<minimum?'BELOW':s.min===minimum&&maximum===minimum?'EQUAL':'RANGE',reason:null,offerMin:s.min,offerMax:maximum,differenceMin:round(s.min-minimum),differenceMax:round(maximum-minimum),percentMin:round((s.min/minimum-1)*100),percentMax:round((maximum/minimum-1)*100)};
}
module.exports={rows,compareSalary,numberInQuote};
