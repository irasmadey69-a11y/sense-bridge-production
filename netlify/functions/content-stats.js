const {getStore, connectLambda} = require('@netlify/blobs');
const metrics = require('./_content-metrics');
exports.handler = async event => {
  const headers = {'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store'};
  const response = (statusCode, data) => ({statusCode, headers, body: JSON.stringify(data)});
  if (event.httpMethod !== 'POST') return response(405, {ok: false});
  let body;
  try {body = JSON.parse(event.body || '{}');} catch (_) {return response(400, {ok: false});}
  if (!process.env.ADMIN_PIN || body.adminPin !== process.env.ADMIN_PIN) return response(403, {ok: false});
  try {
    connectLambda(event);
    const store = getStore({name: 'sb-stats', consistency: 'strong', siteID: process.env.NETLIFY_SITE_ID, token: process.env.NETLIFY_AUTH_TOKEN});
    const [snapshot, clicks, installs] = await Promise.all([
      metrics.read(store), store.get('lang_shortcut_click'), store.get('lang_shortcut_add')
    ]);
    return response(200, {ok: true, snapshot, installationLanguages: {clicks: JSON.parse(clicks || '{}'), confirmed: JSON.parse(installs || '{}')}});
  } catch (_) {return response(503, {ok: false, error: 'Nie udało się odczytać statystyk. Spróbuj ponownie.'});}
};
