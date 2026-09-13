const { getStore, connectLambda } = require("@netlify/blobs");

exports.handler = async (event, context) => {
  const method = String(event?.httpMethod || "").toUpperCase();
  if (method === "OPTIONS") return json(200, { ok: true });
  if (method !== "POST") return json(405, { ok: false, error: "Method not allowed" });

  try {
    connectLambda(event);
    const body = safeJson(event.body);
    if (!body) return json(400, { ok: false, error: "Invalid JSON body" });
    const email = String(body.email || "").trim().toLowerCase();
    const requestLang = normCode(body.lang || existingLangFallback(body) || "UNKNOWN");
    const requestCountryCode = requestCountry(event, context);
    if (!email || !email.includes("@")) return json(400, { ok: false, error: "Missing email" });

    const users = getStore({ name: "sb-users", siteID: process.env.NETLIFY_SITE_ID, token: process.env.NETLIFY_AUTH_TOKEN });
    // Keep the existing store so no migration or admin-data loss is needed.
    const requests = getStore({ name: "sb-payments", siteID: process.env.NETLIFY_SITE_ID, token: process.env.NETLIFY_AUTH_TOKEN });
    const requestStats = getStore({ name: "sb-payment-stats", siteID: process.env.NETLIFY_SITE_ID, token: process.env.NETLIFY_AUTH_TOKEN });
    const stats = getStore({ name: "sb-stats", siteID: process.env.NETLIFY_SITE_ID, token: process.env.NETLIFY_AUTH_TOKEN });
    const now = Date.now();

    const raw = await users.get(email);
    const existing = raw ? safeJson(raw) : null;
    const status = String(existing?.status || "NONE").toUpperCase();
    if (status === "BLOCKED") return json(200, { ok: true, status: "BLOCKED", emailSent: false });
    if (status === "ACTIVE" || status === "BETA") return json(200, { ok: true, status, emailSent: false, message: "User already has access" });

    const previousRequestCount = Math.max(0, Number(existing?.requestCount) || 0);
    const requestCount = previousRequestCount + 1;
    const previousHistory = Array.isArray(existing?.requestHistory) ? existing.requestHistory : [];
    const requestHistory = [...previousHistory, now].slice(-50);
    const record = { email, plan: "free-request", paymentTitle: "ACCESS_REQUEST", createdAt: now, kind: "ACCESS_REQUEST", requestNumber: requestCount, country: requestCountryCode, lang: requestLang };
    await requests.set(`${now}_${email}`, JSON.stringify(record));
    await incrementRequestCounter(requestStats, now);
    if (previousRequestCount === 0) await incrementStat(stats, "access_request_unique");

    const userData = {
      ...(existing && typeof existing === "object" ? existing : {}),
      email, status: "PENDING", plan: existing?.plan || "free-request",
      createdAt: existing?.createdAt || now, requestedAt: now, lastRequestAt: now,
      requestCount, requestHistory, requestCountry: requestCountryCode, requestLang, last: "Poproszono o dalszy dostęp"
    };
    await users.set(email, JSON.stringify(userData));

    const mailResult = await sendRequestEmail({ email, createdAt: now, repeated: requestCount > 1, requestCount, requestCountry: requestCountryCode, requestLang });
    return json(200, { ok: true, status: "PENDING", requestCount, emailSent: mailResult.sent, emailError: mailResult.error || null });
  } catch (e) {
    console.error("access request error:", e);
    return json(500, { ok: false, error: e?.message || String(e) });
  }
};

async function sendRequestEmail({ email, createdAt, repeated, requestCount, requestCountry, requestLang }) {
  if (!process.env.RESEND_API_KEY) return { sent: false, error: "Missing RESEND_API_KEY" };
  const subject = repeated ? "Ponowne zgłoszenie dostępu Sense Bridge" : "Nowe zgłoszenie dostępu Sense Bridge";
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { "Authorization": "Bearer " + process.env.RESEND_API_KEY, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: "Sense Bridge <onboarding@resend.dev>",
        to: ["madey.verpakken@gmail.com"],
        subject,
        html: `<h2>${escapeHtml(subject)}</h2><p><b>Email użytkownika:</b> ${escapeHtml(email)}</p><p><b>Status:</b> PENDING</p><p><b>Numer prośby tego użytkownika:</b> ${Number(requestCount)||1}</p><p><b>Kraj:</b> ${escapeHtml(requestCountry||"UNKNOWN")}</p><p><b>Język aplikacji:</b> ${escapeHtml(requestLang||"UNKNOWN")}</p><p><b>Zgłoszono:</b> ${new Date(createdAt).toLocaleString("pl-PL")}</p><p>Użytkownik wykorzystał bezpłatny limit i prosi o dalszy dostęp. Rozpatrz zgłoszenie w panelu admina.</p>`
      })
    });
    const txt = await res.text();
    if (!res.ok) return { sent: false, error: "Resend error " + res.status + ": " + txt };
    return { sent: true, error: null };
  } catch (e) { return { sent: false, error: e?.message || String(e) }; }
}

async function incrementStat(store, key) {
  const raw = await store.get(key); const n = raw ? parseInt(raw,10) : 0; const next = Number.isFinite(n) ? n + 1 : 1; await store.set(key,String(next)); return next;
}
async function incrementRequestCounter(store, now) {
  const key = "payment_clicks_total"; // legacy key kept to preserve historical/admin compatibility
  const raw = await store.get(key);
  const previous = safeJson(raw);
  const total = Math.max(0, Number(previous?.total) || 0) + 1;
  await store.set(key, JSON.stringify({ total, updatedAt: now, kind: "access_requests" }));
  return total;
}
function safeJson(value){ try{ if(value && typeof value === "object") return value; return JSON.parse(value || "{}"); }catch{return null;} }
function escapeHtml(str){ return String(str ?? "").replace(/[&<>"']/g,s=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[s])); }
function existingLangFallback(body){return body&&body.uiLang?body.uiLang:"UNKNOWN";}

function normCode(v, maxLen=8){
  const s=String(v||"").trim().toUpperCase().replace(/[^A-Z0-9_-]/g,"");
  return s && s.length<=maxLen ? s : "UNKNOWN";
}
function requestCountry(event, context){
  const h=event?.headers||{};
  return normCode(
    h["x-nf-country"] || h["X-Nf-Country"] || h["x-country"] || h["X-Country"] ||
    h["cf-ipcountry"] || h["CF-IPCountry"] || event?.geo?.country?.code || context?.geo?.country?.code || "UNKNOWN",
    4
  );
}
async function incrementMap(store,key,label){
  const raw=await store.get(key);
  let map={};
  try{ map=raw?JSON.parse(raw):{}; }catch(_){ map={}; }
  if(!map || typeof map!=="object" || Array.isArray(map)) map={};
  const k=normCode(label);
  map[k]=Math.max(0,Number(map[k])||0)+1;
  await store.set(key,JSON.stringify(map));
  return map[k];
}
async function readMap(store,key){
  const raw=await store.get(key);
  try{ const v=raw?JSON.parse(raw):{}; return v&&typeof v==="object"&&!Array.isArray(v)?v:{}; }catch(_){ return {}; }
}

function json(statusCode,obj){ return { statusCode, headers:{"Content-Type":"application/json; charset=utf-8","Access-Control-Allow-Origin":"*","Access-Control-Allow-Headers":"Content-Type","Access-Control-Allow-Methods":"POST, OPTIONS","Cache-Control":"no-store"}, body:JSON.stringify(obj) }; }
