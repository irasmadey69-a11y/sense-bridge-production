const { getStore } = require("@netlify/blobs");

exports.handler = async (event) => {
  try {
    if (event.httpMethod !== "POST") {
      return json(405, { ok: false, error: "Method not allowed" });
    }

    const body = JSON.parse(event.body || "{}");
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

    const data = JSON.parse(raw);
    const now = Date.now();

    if (data.status === "BLOCKED") {
      return json(200, { ok: true, status: "BLOCKED" });
    }

    if (!data.expires || now > data.expires) {
      return json(200, { ok: true, status: "EXPIRED" });
    }

    return json(200, {
      ok: true,
      status: "ACTIVE",
      plan: data.plan,
      expires: data.expires
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
