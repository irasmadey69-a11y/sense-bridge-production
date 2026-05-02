const { getStore } = require("@netlify/blobs");

exports.handler = async (event) => {
  try {
    const store = getStore({
      name: "sb-stats",
      siteID: process.env.NETLIFY_SITE_ID,
      token: process.env.NETLIFY_AUTH_TOKEN
    });

    const key = "visits";

    let count = await store.get(key);
    count = count ? parseInt(count, 10) : 0;

    if (event.httpMethod === "POST") {
      count++;
      await store.set(key, String(count));
    }

    return json(200, { ok: true, visits: count });
  } catch (e) {
    return json(500, { ok: false, error: e.message });
  }
};

function json(statusCode, body) {
  return {
    statusCode,
    headers: { "Content-Type": "application/json; charset=utf-8" },
    body: JSON.stringify(body)
  };
}
