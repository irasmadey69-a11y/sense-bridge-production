const { getStore } = require("@netlify/blobs");

exports.handler = async (event) => {
  try {
    if (event.httpMethod !== "POST") {
      return json(405, { ok: false, error: "Method not allowed" });
    }

    const body = JSON.parse(event.body || "{}");
    const email = String(body.email || "").trim().toLowerCase();
    const plan = String(body.plan || "").trim();

    if (!email || !plan) {
      return json(400, { ok: false, error: "Missing email or plan" });
    }

    let ms = 0;
    if (plan === "24h") ms = 24 * 60 * 60 * 1000;
    if (plan === "7d") ms = 7 * 24 * 60 * 60 * 1000;
    if (plan === "30d") ms = 30 * 24 * 60 * 60 * 1000;

    if (!ms) {
      return json(400, { ok: false, error: "Invalid plan" });
    }

    const now = Date.now();
    const expires = now + ms;

    const store = getStore("sb-users");

    await store.set(email, JSON.stringify({
      email,
      plan,
      status: "ACTIVE",
      createdAt: now,
      expires
    }));

    return json(200, {
      ok: true,
      email,
      plan,
      status: "ACTIVE",
      expires
    });
  } catch (e) {
    return json(500, { ok: false, error: e.message || String(e) });
  }
};

function json(statusCode, obj) {
  return {
    statusCode,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*"
    },
    body: JSON.stringify(obj)
  };
}
