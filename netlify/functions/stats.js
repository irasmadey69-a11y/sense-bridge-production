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

    const store = getStore({
      name: "sb-stats",
      siteID: process.env.NETLIFY_SITE_ID,
      token: process.env.NETLIFY_AUTH_TOKEN
    });

    const visits = await getCount(store, "visits");
    const analyzes = await getCount(store, "analyzes");
    const appOpens = await getCount(store, "app_open");
    const shortcutAdds = await getCount(store, "shortcut_add");
    const ocrUses = await getCount(store, "ocr_use");
    const returnUsers = await getCount(store, "return_user");

    return json(200, {
      ok: true,
      visits,
      analyzes,
      appOpens,
      shortcutAdds,
      ocrUses,
      returnUsers
    });

  } catch (e) {
    return json(500, { ok: false, error: e.message });
  }
};

async function getCount(store, key) {
  const raw = await store.get(key);
  const n = raw ? parseInt(raw, 10) : 0;
  return Number.isFinite(n) ? n : 0;
}

function json(statusCode, body) {
  return {
    statusCode,
    headers: { "Content-Type": "application/json; charset=utf-8" },
    body: JSON.stringify(body)
  };
}
