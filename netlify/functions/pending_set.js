const atomicStats = require('./_atomic-stats');
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
    const requestLang = normCode(body.lang || body.uiLang || "UNKNOWN");
    const requestCountryCode = requestCountry(event, context);
    if (!email || !email.includes("@")) return json(400, { ok: false, error: "Missing email" });

    const users = getStore({ name: "sb-users", siteID: process.env.NETLIFY_SITE_ID, token: process.env.NETLIFY_AUTH_TOKEN });
    const requests = getStore({ name: "sb-payments", siteID: process.env.NETLIFY_SITE_ID, token: process.env.NETLIFY_AUTH_TOKEN });
    const requestStats = getStore({ name: "sb-payment-stats", siteID: process.env.NETLIFY_SITE_ID, token: process.env.NETLIFY_AUTH_TOKEN });
    const stats = getStore({ name: "sb-stats", siteID: process.env.NETLIFY_SITE_ID, token: process.env.NETLIFY_AUTH_TOKEN });
    const now = Date.now();

    const raw = await users.get(email);
    const existing = raw ? safeJson(raw) : null;
    const status = String(existing?.status || "NONE").toUpperCase();
    const nowForStatus = Date.now();
    const expiresForStatus = Number(existing?.expires);
    const hasFutureExpiry = Number.isFinite(expiresForStatus) && expiresForStatus > nowForStatus;

    if (status === "BLOCKED") {
      return json(200, { ok: true, status: "BLOCKED", requestSaved: false, emailSent: false, message: "User is blocked" });
    }

    // BETA naprawdę ma stały dostęp. Dla ACTIVE patrzymy również na datę wygaśnięcia.
    // Stare rekordy zostawiały status ACTIVE nawet po upływie expires. Wcześniej właśnie
    // przez to prośba użytkownika była po cichu odrzucana: access_check widział EXPIRED,
    // ale pending_set widział surowe ACTIVE i niczego nie zapisywał ani nie wysyłał maila.
    if (status === "BETA" || (status === "ACTIVE" && hasFutureExpiry)) {
      return json(200, {
        ok: true,
        status: status === "BETA" ? "BETA" : "ACTIVE",
        requestSaved: false,
        emailSent: false,
        message: "User already has active access"
      });
    }

    const previousRequestCount = Math.max(0, Number(existing?.requestCount) || 0);
    const requestCount = previousRequestCount + 1;
    const previousHistory = Array.isArray(existing?.requestHistory) ? existing.requestHistory : [];
    const requestHistory = [...previousHistory, now].slice(-50);
    const requestKey = `${now}_${email}`;

    const baseRecord = {
      email,
      plan: "free-request",
      paymentTitle: "ACCESS_REQUEST",
      createdAt: now,
      kind: "ACCESS_REQUEST",
      requestNumber: requestCount,
      country: requestCountryCode,
      lang: requestLang
    };

    // Najpierw zapisujemy samo zgłoszenie. Statystyki i e-mail nie mogą
    // zablokować prawidłowego zgłoszenia użytkownika.
    await requests.set(requestKey, JSON.stringify(baseRecord));
    let analyticsError = null;
    try { await incrementRequestCounter(requestStats, now); }
    catch (e) { analyticsError = e?.message || String(e); console.error("access request counter error:", e); }

    const userData = {
      ...(existing && typeof existing === "object" ? existing : {}),
      email,
      status: "PENDING",
      plan: existing?.plan || "free-request",
      createdAt: existing?.createdAt || now,
      requestedAt: now,
      lastRequestAt: now,
      requestCount,
      requestHistory,
      requestCountry: requestCountryCode,
      requestLang,
      last: "Poproszono o dalszy dostęp"
    };
    await users.set(email, JSON.stringify(userData));

    // Niezależna kolejka zgłoszeń: admin nie zależy już od listowania pojedynczych blobów.
    // To jest zapis dodatkowy; stary sb-payments pozostaje bez zmian dla kompatybilności.
    try {
      await appendRequestQueue(stats, { ...baseRecord, key: requestKey });
    } catch (e) {
      console.error("access request queue error:", e);
    }

    // Mail używa dokładnie tego samego, sprawdzonego nadawcy i odbiorcy
    // co działający mail po ręcznej aktywacji w panelu admina.
    let mailResult = await sendRequestEmail({
      email, createdAt: now, repeated: requestCount > 1, requestCount,
      requestCountry: requestCountryCode, requestLang
    });
    // Jeden bezpieczny retry przy chwilowym błędzie Resend.
    if (!mailResult.sent) {
      console.error("access request email first attempt failed:", mailResult.error);
      await new Promise(resolve => setTimeout(resolve, 350));
      mailResult = await sendRequestEmail({
        email, createdAt: now, repeated: requestCount > 1, requestCount,
        requestCountry: requestCountryCode, requestLang
      });
    }

    // Analityka jest ważna, ale jej chwilowy błąd nie może zatrzymać
    // zgłoszenia ani wysyłki maila.
    try {
      await incrementStat(stats, "access_request");
      await incrementMap(stats, "geo_access_request", requestCountryCode);
      await incrementMap(stats, "lang_access_request", requestLang);
      if (previousRequestCount === 0) await incrementStat(stats, "access_request_unique");
    } catch (e) {
      analyticsError = e?.message || String(e);
      console.error("access request analytics error:", e);
    }

    // Save mail delivery diagnostics in the existing request/user records.
    // The access request remains valid even if email delivery fails.
    try {
      await requests.set(requestKey, JSON.stringify({...baseRecord,emailSent:mailResult.sent,emailError:mailResult.error||null,emailCheckedAt:Date.now()}));
      await atomicStats.mutateText(users,email,raw=>{
        const latest=safeJson(raw)||userData;
        return JSON.stringify({...latest,notificationEmailSent:mailResult.sent,notificationEmailError:mailResult.error||null,notificationEmailCheckedAt:Date.now()});
      });
    } catch(e) { console.error('access notification diagnostic write error',e); }

    return json(200, {
      ok: true,
      status: "PENDING",
      requestSaved: true,
      requestCount,
      emailSent: mailResult.sent,
      emailError: mailResult.error || null,
      analyticsError
    });
  } catch (e) {
    console.error("access request error:", e);
    return json(500, { ok: false, error: e?.message || String(e) });
  }
};

async function sendRequestEmail({ email, createdAt, repeated, requestCount, requestCountry, requestLang }) {
  if (!process.env.RESEND_API_KEY) return { sent: false, error: "Missing RESEND_API_KEY" };

  const subject = repeated ? "Ponowne zgłoszenie dostępu Sense Bridge" : "Nowe zgłoszenie dostępu Sense Bridge";
  const from = "Sense Bridge <onboarding@resend.dev>";
  const to = "madey.verpakken@gmail.com";

  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      signal: AbortSignal.timeout(12000),
      headers: {
        "Authorization": "Bearer " + process.env.RESEND_API_KEY,
        "Content-Type": "application/json",
        "Idempotency-Key": "sb-request-" + require("node:crypto").createHash("sha256").update(email+"|"+createdAt).digest("hex")
      },
      body: JSON.stringify({
        from,
        to: [to],
        subject,
        html: `<h2>${escapeHtml(subject)}</h2><p><b>Email użytkownika:</b> ${escapeHtml(email)}</p><p><b>Status:</b> PENDING</p><p><b>Numer prośby tego użytkownika:</b> ${Number(requestCount)||1}</p><p><b>Kraj:</b> ${escapeHtml(requestCountry||"UNKNOWN")}</p><p><b>Język aplikacji:</b> ${escapeHtml(requestLang||"UNKNOWN")}</p><p><b>Zgłoszono:</b> ${new Date(createdAt).toLocaleString("pl-PL")}</p><p>Użytkownik wykorzystał bezpłatny limit i prosi o dalszy dostęp. Rozpatrz zgłoszenie w panelu admina.</p>`
      })
    });
    const txt = await res.text();
    if (!res.ok) return { sent: false, error: "Resend error " + res.status + ": " + txt.slice(0, 500) };
    return { sent: true, error: null };
  } catch (e) {
    return { sent: false, error: e?.message || String(e) };
  }
}

async function appendRequestQueue(store,item) {
  await atomicStats.mutateText(store,'access_requests_queue_v2',raw=>{
    let arr;try{arr=JSON.parse(raw||'[]');}catch{arr=[];}
    if(!Array.isArray(arr))arr=[];
    return JSON.stringify([...arr,item].slice(-500));
  });
}

async function incrementStat(store,key){return atomicStats.increment(store,key);}

async function incrementRequestCounter(store,now) {
  const value=await atomicStats.mutateText(store,'payment_clicks_total',raw=>{
    const old=safeJson(raw);
    return JSON.stringify({total:Math.max(0,Number(old?.total)||0)+1,updatedAt:now,kind:'access_requests'});
  });
  return JSON.parse(value).total;
}

function safeJson(value) {
  try {
    if (value && typeof value === "object") return value;
    return JSON.parse(value || "{}");
  } catch {
    return null;
  }
}
function escapeHtml(str) {
  return String(str ?? "").replace(/[&<>"']/g, s => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[s]));
}
function normCode(v, maxLen = 8) {
  const s = String(v || "").trim().toUpperCase().replace(/[^A-Z0-9_-]/g, "");
  return s && s.length <= maxLen ? s : "UNKNOWN";
}
function requestCountry(event, context) {
  const h = event?.headers || {};
  return normCode(
    h["x-nf-country"] || h["X-Nf-Country"] || h["x-country"] || h["X-Country"] ||
    h["cf-ipcountry"] || h["CF-IPCountry"] || event?.geo?.country?.code || context?.geo?.country?.code || "UNKNOWN",
    4
  );
}
async function incrementMap(store,key,label){return atomicStats.incrementMap(store,key,label);}
function json(statusCode, obj) {
  return {
    statusCode,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Headers": "Content-Type",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Cache-Control": "no-store"
    },
    body: JSON.stringify(obj)
  };
}
