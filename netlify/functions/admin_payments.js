const { getStore, connectLambda } = require("@netlify/blobs");

exports.handler = async (event) => {
  try {
    connectLambda(event);

    const method = String(event?.httpMethod || "").toUpperCase();
    if (method === "OPTIONS") return json(200, { ok: true });
    if (method !== "POST") return json(405, { ok: false, error: "Method not allowed" });
    const body = JSON.parse(event.body || "{}");
    const adminPin = String(body.adminPin || "").trim();
    if (!process.env.ADMIN_PIN || adminPin !== process.env.ADMIN_PIN) {
      return json(401, { ok: false, error: "Unauthorized" });
    }

    const store = getStore({
      name: "sb-payments",
      siteID: process.env.NETLIFY_SITE_ID,
      token: process.env.NETLIFY_AUTH_TOKEN
    });

    const list = await store.list();

    const items = [];

    for (const entry of list.blobs) {
      try {
        const raw = await store.get(entry.key);

        if (!raw) continue;

        const data = JSON.parse(raw);

        items.push({
          key: entry.key,
          ...data
        });

      } catch (e) {
        console.log("Payment parse error:", e.message);
      }
    }

    items.sort((a, b) => {
      return Number(b.createdAt || 0) - Number(a.createdAt || 0);
    });

    return json(200, {
      ok: true,
      count: items.length,
      items
    });

  } catch (e) {
    return json(500, {
      ok: false,
      error: e.message || String(e)
    });
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
