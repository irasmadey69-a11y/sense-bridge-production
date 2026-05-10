const { getStore } = require("@netlify/blobs");

const ALLOWED_EVENTS = [
  "app_open",
  "shortcut_add",
  "ocr_use",
  "return_user"
];

exports.handler = async (event) => {
  try {
    if (event.httpMethod !== "POST") {
      return json(405, { ok: false, error: "Method not allowed" });
    }

    const body = JSON.parse(event.body || "{}");
    const eventName = String(body.event || "").trim();

    if (!ALLOWED_EVENTS.includes(eventName)) {
      return json(400, { ok: false, error: "Unknown event" });
    }

    const store = getStore({
      name: "sb-stats",
      siteID: process.env.NETLIFY_SITE_ID,
      token: process.env.NETLIFY_AUTH_TOKEN
    });

    const currentRaw = await store.get(eventName);
    let count = currentRaw ? parseInt(currentRaw, 10) : 0;
    count++;

    await store.set(eventName, String(count));

    return json(200, {
      ok: true,
      event: eventName,
      count
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