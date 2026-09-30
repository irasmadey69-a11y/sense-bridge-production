const { getStore, connectLambda } = require("@netlify/blobs");

exports.handler = async (event) => {
  const method = String(event?.httpMethod || "").toUpperCase();
  if (method === "OPTIONS") return json(200, { ok: true });
  if (method !== "POST") return json(405, { ok: false, error: "Method not allowed" });

  try {
    connectLambda(event);
    const body = safeJson(event.body);
    if (!body) return json(400, { ok: false, error: "Invalid JSON body" });

    const email = String(body.email || "").trim().toLowerCase();
    if (!email || !email.includes("@")) return json(400, { ok: false, error: "Missing email" });

    const clientUsedRaw = Number(body.used);
    const clientUsed = Number.isFinite(clientUsedRaw) ? Math.max(0, Math.floor(clientUsedRaw)) : 0;

    const users = getStore({
      name: "sb-users",
      siteID: process.env.NETLIFY_SITE_ID,
      token: process.env.NETLIFY_AUTH_TOKEN
    });

    const raw = await users.get(email);
    const existing = raw ? safeJson(raw) : {};
    const status = String(existing?.status || "NONE").toUpperCase();
    if (status === "BLOCKED") {
      return json(403, { ok: false, status: "BLOCKED", error: "Blocked" });
    }

    const serverUsed = Math.max(0, Number(existing?.freeUsesUsed) || 0);
    // Never lower the server-side counter. This preserves history and prevents
    // a cleared browser/localStorage from resetting already consumed uses.
    const freeUsesUsed = Math.max(serverUsed, clientUsed);
    const bonusUsesGranted = Math.max(0, Number(existing?.bonusUsesGranted) || 0);
    const freeUsesAllowance = 3 + bonusUsesGranted;
    const freeUsesRemaining = Math.max(0, freeUsesAllowance - freeUsesUsed);
    const now = Date.now();

    const userData = {
      ...(existing && typeof existing === "object" ? existing : {}),
      email,
      status: existing?.status || "NONE",
      createdAt: existing?.createdAt || now,
      freeUsesUsed,
      freeUsesSyncedAt: now
    };

    await users.set(email, JSON.stringify(userData));

    return json(200, {
      ok: true,
      status: String(userData.status || "NONE").toUpperCase(),
      freeUsesUsed,
      freeUsesAllowance,
      freeUsesRemaining,
      bonusUsesGranted,
      requestCount: Math.max(0, Number(userData.requestCount) || 0)
    });
  } catch (e) {
    console.error("free_usage_sync error:", e);
    return json(500, { ok: false, error: e?.message || String(e) });
  }
};

function safeJson(value) {
  try {
    if (value && typeof value === "object") return value;
    return JSON.parse(value || "{}");
  } catch {
    return null;
  }
}

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
