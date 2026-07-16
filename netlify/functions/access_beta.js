const { getStore, connectLambda } = require("@netlify/blobs");

exports.handler = async (event) => {
  try {
    connectLambda(event);

    if (event.httpMethod === "OPTIONS") {
      return json(200, { ok: true });
    }

    if (event.httpMethod !== "POST") {
      return json(405, { ok: false, error: "Method not allowed" });
    }

    const body = JSON.parse(event.body || "{}");
    const adminPin = String(body.adminPin || "").trim();
    const email = String(body.email || "").trim().toLowerCase();

    if (!process.env.ADMIN_PIN) {
      return json(500, { ok: false, error: "Missing ADMIN_PIN" });
    }

    if (adminPin !== process.env.ADMIN_PIN) {
      return json(403, { ok: false, error: "Brak dostępu (PIN)" });
    }

    if (!email) {
      return json(400, { ok: false, error: "Missing email" });
    }

    const store = getStore({
      name: "sb-users",
      siteID: process.env.NETLIFY_SITE_ID,
      token: process.env.NETLIFY_AUTH_TOKEN
    });

    const raw = await store.get(email);
    const existing = raw ? JSON.parse(raw) : { email };
    const now = Date.now();

    // Preserve prior paid-access details in case BETA is later removed manually.
    if (existing.status !== "BETA") {
      existing.previousAccess = {
        status: existing.status || "NONE",
        plan: existing.plan || null,
        expires: existing.expires || null
      };
    }

    existing.email = email;
    existing.status = "BETA";
    existing.plan = "BETA";
    existing.betaAt = existing.betaAt || now;
    existing.updatedAt = now;
    existing.last = "Google Play closed tester";

    // BETA access does not expire.
    delete existing.expires;

    await store.set(email, JSON.stringify(existing));

    return json(200, {
      ok: true,
      email,
      status: "BETA",
      plan: "BETA",
      expires: null
    });

  } catch (e) {
    return json(500, { ok: false, error: e.message || String(e) });
  }
};

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
