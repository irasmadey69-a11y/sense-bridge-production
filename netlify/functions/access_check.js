const { getStore, connectLambda } = require("@netlify/blobs");

exports.handler = async (event) => {
  const method = String(event?.httpMethod || "").toUpperCase();

  // Safe CORS preflight support. This does not touch the Blob store.
  if (method === "OPTIONS") {
    return json(200, { ok: true });
  }

  if (method !== "POST") {
    return json(405, { ok: false, error: "Method not allowed" });
  }

  try {
    connectLambda(event);

    const body = safeJson(event.body);
    if (!body) {
      return json(400, { ok: false, error: "Invalid JSON body" });
    }

    const email = String(body.email || "").trim().toLowerCase();

    if (!email) {
      return json(400, { ok: false, error: "Missing email" });
    }

    const store = getStore({
      name: "sb-users",
      siteID: process.env.NETLIFY_SITE_ID,
      token: process.env.NETLIFY_AUTH_TOKEN
    });

    const raw = await store.get(email);

    if (!raw) {
      return json(200, { ok: true, status: "NONE" });
    }

    const data = safeJson(raw);
    if (!data || typeof data !== "object") {
      return json(500, { ok: false, error: "Invalid access record" });
    }

    const now = Date.now();
    const storedStatus = String(data.status || "").trim().toUpperCase();

    if (storedStatus === "BLOCKED") {
      return json(200, { ok: true, status: "BLOCKED" });
    }

    // Google Play closed tester: full access.
    // A far-future technical expiry is returned because the existing
    // frontend requires a valid expires value to unlock access.
    if (storedStatus === "BETA") {
      return json(200, {
        ok: true,
        status: "ACTIVE",
        plan: "BETA",
        accessType: "BETA",
        aiLimit: 100,
        expires: now + (10 * 365 * 24 * 60 * 60 * 1000)
      });
    }

    // Keep the existing production behaviour:
    // every non-blocked record with a valid future expiry is ACTIVE.
    const expires = Number(data.expires);

    if (!Number.isFinite(expires) || expires <= 0 || now > expires) {
      return json(200, { ok: true, status: "EXPIRED" });
    }

    return json(200, {
      ok: true,
      status: "ACTIVE",
      plan: data.plan,
      accessType: data.accessType || (data.plan === "30d-pro" ? "PRO" : "BASIC"),
      aiLimit: aiLimitForPlan(data.plan),
      expires
    });

  } catch (e) {
    console.error("access_check error:", e);
    return json(500, {
      ok: false,
      error: e?.message || String(e)
    });
  }
};

function aiLimitForPlan(plan) {
  const limits = { "24h": 3, "7d": 15, "30d": 40, "30d-pro": 100 };
  return limits[String(plan || "").toLowerCase()] || 2;
}

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
