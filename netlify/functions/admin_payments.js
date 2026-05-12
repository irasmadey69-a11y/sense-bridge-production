const { getStore, connectLambda } = require("@netlify/blobs");

exports.handler = async (event) => {
  try {
    connectLambda(event);

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
      "Cache-Control": "no-store"
    },
    body: JSON.stringify(obj)
  };
}
