const { getStore } = require("@netlify/blobs");

exports.handler = async (event) => {
  try {
    const body = JSON.parse(event.body || "{}");
const adminPin = String(body.adminPin || "");

if (adminPin !== process.env.ADMIN_PIN) {
  return json(403, { ok: false, error: "Brak dostępu (PIN)" });
}
    if (event.httpMethod !== "POST") {
      return json(405, { ok: false, error: "Method not allowed" });
    }

    const email = String(body.email || "").trim().toLowerCase();

    if (!email) {
      return json(400, { ok: false, error: "Missing email" });
    }

    const store = getStore("sb-users");

    const raw = await store.get(email);
    const existing = raw ? JSON.parse(raw) : { email };

    existing.email = email;
    existing.status = "BLOCKED";
    existing.blockedAt = Date.now();

    await store.set(email, JSON.stringify(existing));

    return json(200, {
      ok: true,
      email,
      status: "BLOCKED"
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
