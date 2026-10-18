const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname, '..');
const exercise = require('../netlify/functions/_exercise');
const solution = { sourceLanguage: 'NL', userAnswer: 'Wynik: 72,60 EUR.', sourceAnswer: 'Antwoord: 72,60 EUR.', complete: true, missingInformation: '' };
function guidance(replies) {
  const calls = []; const usage = [];
  const context = { exports: {}, process: { env: { OPENAI_API_KEY: 'test-only' } }, URL,
    require(name) {
      if (name === './_usage') return { recordUsage: async (...args) => usage.push(args[3]) };
      return require(path.join(root, 'netlify/functions', name));
    },
    fetch: async (_url, options) => { calls.push(JSON.parse(options.body)); const data = replies.shift(); assert.ok(data, 'unexpected extra API call'); return { ok: true, json: async () => data }; }
  };
  vm.runInNewContext(fs.readFileSync(path.join(root, 'netlify/functions/ai-document-guidance.js'), 'utf8'), context);
  return { run: async body => JSON.parse((await context.exports.handler({ httpMethod: 'POST', body: JSON.stringify(body) }, {})).body), calls, usage };
}
test('different exercise language produces two full sections and regional guidance is scoped', async () => {
  const h = guidance([{ status: 'completed', output_text: JSON.stringify(solution) }, { status: 'completed', output_text: JSON.stringify(solution) }]);
  const out = await h.run({ mode: 'exercise', text: 'Een jas kost 80 euro. Bereken de prijs.', userLang: 'PL', sourceLang: 'NL' });
  assert.equal(out.ok, true); assert.match(out.result, /Wynik: 72,60/); assert.match(out.result, /Antwoord: 72,60/);
  assert.equal(h.calls[0].text.format.type, 'json_schema'); assert.equal(h.calls[0].store, false);
  assert.doesNotMatch(h.calls[0].instructions, /final answer must be written entirely|2–5|Do not restate/);
});
test('complex exercise is independently reviewed and corrected answer is rendered', async () => {
  const candidate = { ...solution, complete: false, userAnswer: 'Oblicz prędkość.' };
  const checked = { ...solution, sourceLanguage: 'PL', sourceAnswer: '', userAnswer: '1) u=12,6634 m/s. 2) V=2,5327 m/s. 3) strata=12,829 J. 4) Tak. 5) d=0,30775 m.' };
  const h = guidance([{ status: 'completed', output_text: JSON.stringify(candidate) }, { status: 'completed', output_text: JSON.stringify(checked) }]);
  const out = await h.run({ mode: 'exercise', text: '1) Oblicz u. 2) Oblicz V. 3) Oblicz stratę. 4) Czy wróci? 5) Oblicz drogę.', userLang: 'PL' });
  assert.equal(h.calls.length, 2); assert.equal(h.usage[1].feature, 'EXERCISE_REVIEW'); assert.match(out.result, /12,6634/); assert.doesNotMatch(out.result, /Oblicz prędkość/);
  assert.ok(JSON.parse(h.calls[1].input).originalExercise);
});
test('missing translation triggers repair; still missing translation is rejected', async () => {
  const bad = { ...solution, sourceAnswer: '' };
  const h = guidance([{ output_text: JSON.stringify(bad) }, { output_text: JSON.stringify(bad) }]);
  assert.equal((await h.run({ mode: 'exercise', text: 'Bereken 2+2.', userLang: 'PL' })).ok, false);
});
test('truncated response is not displayed as successful solution', async () => {
  const h = guidance([{ status: 'incomplete', output_text: 'Incomplete' }]);
  assert.equal((await h.run({ mode: 'exercise', text: 'Oblicz 2+2.', userLang: 'PL' })).ok, false);
});
test('same language does not duplicate solution, insufficient-data explanation can be complete', () => {
  const s = { ...solution, sourceLanguage: 'PL', sourceAnswer: '', userAnswer: 'Sam obwód nie wyznacza pola.', missingInformation: 'Długość jednego boku.' };
  assert.equal(exercise.render(s, 'PL', 'Polish'), s.userAnswer);
});
test('non-exercise options keep existing request and plain-text result', async () => {
  const h = guidance([{ output_text: 'Options result' }]);
  const out = await h.run({ mode: 'options', text: 'A letter.', userLang: 'EN' });
  assert.equal(out.result, 'Options result'); assert.equal(h.calls[0].model, 'gpt-4o-mini'); assert.equal(h.calls.length, 1);
});
test('fraction rendering preserves grouping and removes spacing commands', () => {
  const s = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  const a = s.indexOf('const answer=String(textValue'); const b = s.indexOf('set("sbDocLabR1",answer)', a);
  const text = vm.runInNewContext(s.slice(a, b) + 'answer', { textValue: 'v=\\frac{m*u}{m+M} \\, m/s' });
  assert.equal(text, 'v=(m*u) / (m+M)   m/s');
});
test('email notification still sends when request-stat counter storage fails', async () => {
  const maps = new Map(); const calls = [];
  const context = { exports: {}, Date, AbortSignal, console: { error() {} }, setTimeout, process: { env: { RESEND_API_KEY: 'test-only' } },
    require: name => name === './_mail' ? (()=>{const box={...context,module:{exports:{}}};box.exports=box.module.exports;vm.runInNewContext(fs.readFileSync(path.join(root,'netlify/functions/_mail.js'),'utf8'),box);return box.module.exports;})() : name === '@netlify/blobs' ? ({ connectLambda() {}, getStore({ name }) { if (!maps.has(name)) maps.set(name, new Map()); const m = maps.get(name); return { get: async key => m.get(key) || null, getWithMetadata: async key => m.has(key) ? {data:m.get(key),etag:'test'} : null, set: async (key, value) => { if (name === 'sb-payment-stats') throw new Error('stats down'); m.set(key, value); return {modified:true}; } }; } }) : name.startsWith('.') ? require(path.join(root,'netlify/functions',name)) : require(name),
    fetch: async (_url, options) => { calls.push(JSON.parse(options.body)); return { ok: true, text: async () => '{"id":"test-mail"}' }; }
  };
  vm.runInNewContext(fs.readFileSync(path.join(root, 'netlify/functions/pending_set.js'), 'utf8'), context);
  const out = JSON.parse((await context.exports.handler({ httpMethod: 'POST', body: JSON.stringify({ email: 'test@example.com', lang: 'PL' }) }, {})).body);
  assert.equal(out.requestSaved, true); assert.equal(out.emailSent, true); assert.equal(calls.length, 1); assert.equal(out.analyticsError, 'stats down');
  assert.equal(maps.get('sb-payments').size, 1);
});

