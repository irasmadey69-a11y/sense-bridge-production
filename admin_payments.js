const { getStore, connectLambda } = require("@netlify/blobs");

exports.handler = async (event) => {
  try {
    connectLambda(event);
    const method = String(event?.httpMethod || "").toUpperCase();
    if (method === "OPTIONS") return json(200, { ok: true });
    if (method !== "POST") return json(405, { ok: false, error: "Method not allowed" });
    const body = safeJson(event.body) || {};
    const adminPin = String(body.adminPin || "").trim();
    if (!process.env.ADMIN_PIN || adminPin !== process.env.ADMIN_PIN) return json(401, { ok:false, error:"Unauthorized" });

    const cfg = { siteID: process.env.NETLIFY_SITE_ID, token: process.env.NETLIFY_AUTH_TOKEN };
    const payments = getStore({ name:"sb-payments", ...cfg });
    const users = getStore({ name:"sb-users", ...cfg });
    const stats = getStore({ name:"sb-stats", ...cfg });
    const items = [];
    const errors = [];

    // 1. Nowa, stabilna kolejka (nie wymaga listowania wielu blobów).
    try {
      const raw = await stats.get("access_requests_queue_v2");
      const arr = raw ? JSON.parse(raw) : [];
      if (Array.isArray(arr)) items.push(...arr);
    } catch (e) { errors.push("queue: "+(e.message||e)); }

    // 2. Stara lista sb-payments — zachowujemy pełną kompatybilność i historię.
    try {
      let cursor;
      do {
        const page = await payments.list(cursor ? { cursor } : undefined);
        for (const entry of (page?.blobs || [])) {
          try {
            const raw = await payments.get(entry.key);
            if (!raw) continue;
            const data = JSON.parse(raw);
            items.push({ key: entry.key, ...data });
          } catch (e) { errors.push("payment "+entry.key+": "+(e.message||e)); }
        }
        cursor = page?.next_cursor || page?.nextCursor || null;
      } while (cursor);
    } catch (e) { errors.push("payments list: "+(e.message||e)); }

    // 3. Awaryjnie PENDING z sb-users. Dzięki temu prośba jest widoczna nawet,
    // gdy Netlify Blobs nie zwróci jej z listy sb-payments.
    try {
      let cursor;
      do {
        const page = await users.list(cursor ? { cursor } : undefined);
        for (const entry of (page?.blobs || [])) {
          try {
            const raw = await users.get(entry.key);
            if (!raw) continue;
            const u = JSON.parse(raw);
            if (String(u?.status || "").toUpperCase() !== "PENDING" || !u?.email) continue;
            items.push({
              key: "user_"+entry.key,
              email: u.email,
              plan: u.plan || "free-request",
              paymentTitle: u.paymentTitle || "ACCESS_REQUEST",
              kind: "ACCESS_REQUEST",
              createdAt: u.lastRequestAt || u.requestedAt || u.createdAt || 0,
              requestNumber: Number(u.requestCount)||1,
              country: u.requestCountry || "UNKNOWN",
              lang: u.requestLang || "UNKNOWN",
              emailSent: u.notificationEmailSent,
              emailError: u.notificationEmailError || null,
              source: "sb-users"
            });
          } catch (e) { errors.push("user "+entry.key+": "+(e.message||e)); }
        }
        cursor = page?.next_cursor || page?.nextCursor || null;
      } while (cursor);
    } catch (e) { errors.push("users list: "+(e.message||e)); }

    // Deduplikacja: jedna najnowsza pozycja na konkretną prośbę użytkownika.
    const byId = new Map();
    for (const item of items) {
      if (!item || !item.email) continue;
      const id = String(item.email).toLowerCase()+"|"+String(item.requestNumber||1)+"|"+String(item.createdAt||0);
      if (!byId.has(id)) byId.set(id, item);
    }
    const out = [...byId.values()].sort((a,b)=>Number(b.createdAt||0)-Number(a.createdAt||0));
    return json(200, { ok:true, count:out.length, items:out, diagnostics: errors.slice(0,20) });
  } catch (e) {
    return json(500, { ok:false, error:e.message||String(e) });
  }
};
function safeJson(v){try{return typeof v==="object"&&v?v:JSON.parse(v||"{}")}catch{return null}}
function json(statusCode,obj){return {statusCode,headers:{"Content-Type":"application/json; charset=utf-8","Access-Control-Allow-Origin":"*","Access-Control-Allow-Headers":"Content-Type","Access-Control-Allow-Methods":"POST, OPTIONS","Cache-Control":"no-store"},body:JSON.stringify(obj)}}
