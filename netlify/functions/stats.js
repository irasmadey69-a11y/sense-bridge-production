const { getStore } = require("@netlify/blobs");

exports.handler = async (event) => {
  try {
    if (event.httpMethod !== "POST") {
      return json(405, { ok: false, error: "Method not allowed" });
    }

    const body = JSON.parse(event.body || "{}");
    const adminPin = String(body.adminPin || "");

    if (!process.env.ADMIN_PIN || adminPin !== process.env.ADMIN_PIN) {
      return json(403, { ok: false, error: "Wrong admin PIN" });
    }

    const store = getStore("sb-stats");

    const visitsRaw = await store.get("visits");
    const analyzesRaw = await store.get("analyzes");

    return json(200, {
      ok: true,
      visits: visitsRaw ? parseInt(visitsRaw, 10) : 0,
      analyzes: analyzesRaw ? parseInt(analyzesRaw, 10) : 0
    });
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
