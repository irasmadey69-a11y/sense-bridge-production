const { getStore } = require("@netlify/blobs");

exports.handler = async () => {
  try {
    const store = getStore("sb-stats");

    let count = await store.get("analyzes");
    count = count ? parseInt(count, 10) : 0;
    count++;

    await store.set("analyzes", String(count));

    return json(200, { ok: true, analyzes: count });
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
