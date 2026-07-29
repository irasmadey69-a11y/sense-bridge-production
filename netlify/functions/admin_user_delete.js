const { getStore, connectLambda } = require("@netlify/blobs");

exports.handler = async (event) => {
  const method = String(event?.httpMethod || "").toUpperCase();

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

    const adminPin = String(body.adminPin || "");
    const email = String(body.email || "").trim().toLowerCase();

    if (!process.env.ADMIN_PIN || adminPin !== process.env.ADMIN_PIN) {
      return json(403, { ok: false, error: "Invalid admin PIN" });
    }

    if (!email) {
      return json(400, { ok: false, error: "Missing email" });
    }

    const store = getStore({
      name: "sb-users",
      siteID: process.env.NETLIFY_SITE_ID,
      token: process.env.NETLIFY_AUTH_TOKEN
    });

    const existing = await store.get(email);

    if (!existing) {
      return json(200, {
        ok: true,
        deleted: false,
        email,
        message: "User not found"
      });
    }

    await store.delete(email);

    return json(200, {
      ok: true,
      deleted: true,
      email
    });

  } catch (e) {
    console.error("admin_user_delete error:", e);
    return json(500, {
      ok: false,
      error: e?.message || String(e)
    });
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
