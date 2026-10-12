const {languages}=require('./_world-catalog.json');
exports.name=code=>{const key=String(code||'').toUpperCase();return languages[key]?languages[key].name:'Polish'};
exports.supported=code=>!!languages[String(code||'').toUpperCase()];
