const {getStore, connectLambda} = require('@netlify/blobs');
const metrics = require('./_content-metrics');
const ORIGINS = new Set(['https://sensebridge.app', 'https://www.sensebridge.app', 'https://sense-bridge-production.netlify.app']);
exports.handler = async event => {
  const origin = event.headers?.origin || event.headers?.Origin || '';
  const headers = {'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'Vary': 'Origin'};
  if (!ORIGINS.has(origin)) return {statusCode: 403, headers, body: JSON.stringify({ok: false})};
  headers['Access-Control-Allow-Origin'] = origin;
  headers['Access-Control-Allow-Methods'] = 'POST, OPTIONS';
  headers['Access-Control-Allow-Headers'] = 'Content-Type';
  if (event.httpMethod === 'OPTIONS') return {statusCode: 204, headers, body: ''};
  if (event.httpMethod !== 'POST') return {statusCode: 405, headers, body: JSON.stringify({ok: false})};
  let normalized;
  try {
    if (!event.body || event.body.length > 2048 || event.isBase64Encoded) throw new Error('Invalid body');
    normalized = metrics.normalize(JSON.parse(event.body));
  } catch (_) {return {statusCode: 400, headers, body: JSON.stringify({ok: false})};}
  try {
    connectLambda(event);
    const store = getStore({name: 'sb-stats', siteID: process.env.NETLIFY_SITE_ID, token: process.env.NETLIFY_AUTH_TOKEN});
    await metrics.record(store, normalized);
    return {statusCode: 200, headers, body: JSON.stringify({ok: true})};
  } catch (_) {return {statusCode: 503, headers, body: JSON.stringify({ok: false})};}
};
