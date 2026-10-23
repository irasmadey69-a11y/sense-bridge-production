const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const metrics = require('../netlify/functions/_content-metrics');
function storage() {
  const map = new Map(); const versions = new Map();
  return {map, async get(key) {return map.get(key) ?? null;}, async getWithMetadata(key) {return map.has(key) ? {data: map.get(key), etag: String(versions.get(key))} : null;},
    async set(key, value, options = {}) {
      if (options.onlyIfNew && map.has(key)) return {modified: false};
      if (options.onlyIfMatch && options.onlyIfMatch !== String(versions.get(key))) return {modified: false};
      map.set(key, value); versions.set(key, (versions.get(key) || 0) + 1); return {modified: true};
    }};
}
function handler(name, store) {
  const box = {exports: {}, process: {env: {ADMIN_PIN: 'test-only'}}, require(module) {
    if (module === '@netlify/blobs') return {connectLambda() {}, getStore: () => store};
    return require(path.resolve(__dirname, '../netlify/functions', module));
  }};
  vm.runInNewContext(fs.readFileSync(path.resolve(__dirname, '../netlify/functions', name), 'utf8'), box);
  return box.exports.handler;
}
const event = (body, origin = 'https://sensebridge.app') => ({httpMethod: 'POST', headers: {origin}, body: JSON.stringify(body)});
test('concurrent attribution counters preserve all events and existing totals', async () => {
  const store = storage(); await store.set('shortcut_add', '83');
  const source = {page: '/help/pismo-uwv/', pageLang: 'FAKE', appLang: 'DE', event: 'install_confirm'};
  await Promise.all(Array.from({length: 20}, () => metrics.record(store, metrics.normalize(source))));
  const rows = Object.values((await metrics.read(store)).rows);
  assert.equal(rows[0].install_confirm, 20); assert.equal(rows[0].pageLang, 'PL'); assert.equal(rows[0].appLang, 'DE');
  assert.equal(await store.get('shortcut_add'), '83');
});
test('public endpoint rejects unknown pages, events, large payloads and origins', async () => {
  const store = storage(); const h = handler('content-event.js', store);
  const valid = {event: 'page_view', page: '/help/pismo-uwv/', pageLang: 'PL'};
  for (const request of [event(valid, 'https://attacker.example'), event({...valid, page: '/secret/'}), event({...valid, event: 'analysis_use'}), event({...valid, extra: 'x'.repeat(2200)})]) assert.ok((await h(request)).statusCode >= 400);
  assert.equal(store.map.size, 0);
  assert.equal((await h(event({...valid, email: 'private', document: 'secret'}))).statusCode, 200);
  const raw = await store.get('content-traffic-v1'); assert.ok(!raw.includes('private') && !raw.includes('secret'));
});
test('CORS accepts only production origins and permits the required preflight', async () => {
  const h = handler('content-event.js', storage());
  const response = await h({httpMethod: 'OPTIONS', headers: {origin: 'https://sensebridge.app'}});
  assert.equal(response.statusCode, 204); assert.equal(response.headers['Access-Control-Allow-Origin'], 'https://sensebridge.app');
  assert.equal((await h(event({}, 'https://deploy-preview-9--sense-bridge-www.netlify.app'))).statusCode, 403);
});
test('stats require admin PIN and keep old installation maps distinct from new rows', async () => {
  const store = storage(); await store.set('lang_shortcut_add', JSON.stringify({PL: 24}));
  const h = handler('content-stats.js', store);
  assert.equal((await h(event({adminPin: 'wrong'}))).statusCode, 403);
  const data = JSON.parse((await h(event({adminPin: 'test-only'}))).body);
  assert.equal(data.snapshot.since, null); assert.equal(data.installationLanguages.confirmed.PL, 24);
});
function frontend({mode = 'website', origin = 'https://sensebridge.app', search = '', session = new Map(), dnt = null} = {}) {
  const sent = []; const tasks = []; const events = {}; const links = [{href: 'https://sense-bridge-production.netlify.app/?lang=FR&install=1'}];
  const document = {currentScript: {dataset: {mode}}, readyState: 'complete', documentElement: {lang: 'fr'}, querySelectorAll: () => links, addEventListener(name, fn) {events[name] = fn;}};
  const window = {}; const box = {window, document, location: {origin, pathname: '/help/lettre-arc-canada/', href: origin + '/help/lettre-arc-canada/' + search, search}, navigator: {doNotTrack: dnt}, UI: {lang: 'PL'}, URL, URLSearchParams, Date, Set, Promise,
    sessionStorage: {getItem: key => session.get(key) || null, setItem: (key, value) => session.set(key, value)},
    fetch: (url, options) => {sent.push({url, data: JSON.parse(options.body)}); return Promise.resolve({ok: true});},
    setTimeout: fn => {tasks.push(fn); return tasks.length;}, clearTimeout() {}, MutationObserver: class {observe() {}}};
  vm.runInNewContext(fs.readFileSync(path.resolve(__dirname, '../content-metrics.js'), 'utf8'), box); tasks.forEach(fn => fn());
  return {sent, window, box, links, session, events};
}
test('website preserves destination language and passes the source language separately', () => {
  const f = frontend(); const url = new URL(f.links[0].href);
  assert.equal(url.searchParams.get('lang'), 'FR'); assert.equal(url.searchParams.get('sb_page_lang'), 'FR');
  assert.equal(url.searchParams.get('install'), '1'); assert.equal(f.sent[0].data.event, 'page_view');
  assert.equal(frontend({session: f.session}).sent.length, 0);
});
test('app attributes source text language separately from the current UI installation language', () => {
  const f = frontend({mode: 'app', origin: 'https://sense-bridge-production.netlify.app', search: '?sb_page=%2Fhelp%2Flettre-arc-canada%2F&sb_page_lang=FR'});
  f.window.SBContentMetrics.record('install_click'); f.box.UI.lang = 'NL'; f.window.SBContentMetrics.record('install_confirm'); f.window.SBContentMetrics.record('install_confirm');
  assert.equal(f.sent.length, 3); assert.equal(f.sent[1].data.pageLang, 'FR'); assert.equal(f.sent[1].data.appLang, 'PL'); assert.equal(f.sent[2].data.appLang, 'NL');
});
test('expired sources are not attributed, direct installations are explicit, and previews send nothing', () => {
  const session = new Map([['sb_content_source_v1', JSON.stringify({page: '/help/pismo-uwv/', pageLang: 'PL', until: Date.now() - 1})]]);
  const f = frontend({mode: 'app', origin: 'https://sense-bridge-production.netlify.app', session}); f.window.SBContentMetrics.record('install_confirm');
  assert.equal(f.sent.length, 1); assert.equal(f.sent[0].data.page, 'DIRECT_APP');
  assert.equal(frontend({origin: 'https://deploy-preview-3--sense-bridge-www.netlify.app'}).sent.length, 0);
  assert.equal(frontend({dnt: '1'}).sent.length, 0);
});
