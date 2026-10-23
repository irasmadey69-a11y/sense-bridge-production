const atomic = require('./_atomic-stats');
const pages = require('./_content-pages.json');
const KEY = 'content-traffic-v1';
const languages = new Set(require('./_content-languages.json'));
const pageLanguages = new Set([...Object.values(pages).map(value => value.toUpperCase()), 'ZH-CN', 'UNKNOWN']);
const EVENTS = new Set(['page_view', 'app_click', 'app_arrival', 'install_click', 'install_confirm']);
const LANG = /^[A-Z]{2,3}(?:-[A-Z0-9]{2,8}){0,2}$/;
function language(value) {
  const code = String(value || '').toUpperCase();
  return LANG.test(code) && languages.has(code) ? code : 'UNKNOWN';
}
function normalize(body) {
  if (!body || !EVENTS.has(body.event)) throw new Error('Invalid event');
  const page = String(body.page || '');
  if (!Object.hasOwn(pages, page) && page !== 'DIRECT_APP') throw new Error('Invalid page');
  if (page === 'DIRECT_APP' && !body.event.startsWith('install_')) throw new Error('Invalid direct event');
  const pageLang = page === '/' ? (pageLanguages.has(language(body.pageLang)) ? language(body.pageLang) : 'UNKNOWN') : page === 'DIRECT_APP' ? 'UNKNOWN' : language(pages[page]);
  const appLang = body.event.startsWith('install_') || body.event === 'app_arrival' ? language(body.appLang) : 'UNKNOWN';
  return {event: body.event, page, pageLang, appLang};
}
async function record(store, event, now = new Date().toISOString()) {
  await atomic.mutateText(store, KEY, raw => {
    const data = raw ? JSON.parse(raw) : {version: 1, since: now, rows: {}};
    const key = JSON.stringify([event.page, event.pageLang, event.appLang]);
    if (!data.rows[key] && Object.keys(data.rows).length >= 10000) throw new Error('Statistics capacity reached');
    const row = data.rows[key] || {page: event.page, pageLang: event.pageLang, appLang: event.appLang};
    row[event.event] = Math.max(0, Number(row[event.event]) || 0) + 1;
    data.rows[key] = row;
    return JSON.stringify(data);
  });
}
async function read(store) {
  const raw = await store.get(KEY, {consistency: 'strong'});
  return raw ? JSON.parse(raw) : {version: 1, since: null, rows: {}};
}
module.exports = {normalize, record, read};
