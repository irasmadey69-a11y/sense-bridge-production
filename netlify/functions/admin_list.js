const { getStore, connectLambda } = require("@netlify/blobs");

exports.handler = async (event) => {
  try {
    connectLambda(event);

    if (event.httpMethod === "OPTIONS") {
      return json(200, { ok: true });
    }

    if (event.httpMethod !== "POST") {
      return json(405, { ok: false, error: "Method not allowed" });
    }

    const body = JSON.parse(event.body || "{}");
    const adminPin = String(body.adminPin || "").trim();

    if (!process.env.ADMIN_PIN) {
      return json(500, {
        ok: false,
        error: "Missing ADMIN_PIN"
      });
    }

    if (adminPin !== process.env.ADMIN_PIN) {
      return json(401, {
        ok: false,
        error: "Unauthorized"
      });
    }

    const store = getStore({
      name: "sb-users",
      siteID: process.env.NETLIFY_SITE_ID,
      token: process.env.NETLIFY_AUTH_TOKEN
    });

    const list = await store.list();

    const blobs = Array.isArray(list?.blobs)
      ? list.blobs
      : [];

    const users = [];

    for (const item of blobs) {

      const key = item.key || item.name;

      if (!key) continue;

      try {

        const raw = await store.get(key);

        if (!raw) continue;

        const data = JSON.parse(raw);

        const now = Date.now();

        let status = String(
          data.status || "NONE"
        ).toUpperCase();

        if (
          status !== "BLOCKED" &&
          status !== "PENDING"
        ) {

          if (
            data.expires &&
            now > Number(data.expires)
          ) {
            status = "EXPIRED";
          }
          else if (
            data.expires &&
            now <= Number(data.expires)
          ) {
            status = "ACTIVE";
          }
        }

        users.push({
          email: data.email || key,
          status,
          plan: data.plan || "—",
          expires: data.expires || "—",
          paymentCode: data.paymentCode || "—",
          createdAt: data.createdAt || "—",
          last: data.last || "—"
        });

      } catch (e) {

        users.push({
          email: key,
          status: "ERROR",
          plan: "—",
          expires: "—",
          paymentCode: "—",
          createdAt: "—",
          last: "Cannot read user data"
        });

      }
    }

    users.sort((a, b) => {

      const order = {
        PENDING: 1,
        ACTIVE: 2,
        EXPIRED: 3,
        BLOCKED: 4,
        NONE: 5,
        ERROR: 6
      };

      const sa = order[a.status] || 99;
      const sb = order[b.status] || 99;

      if (sa !== sb) {
        return sa - sb;
      }

      const ta = Number(a.createdAt || 0);
      const tb = Number(b.createdAt || 0);

      return tb - ta;
    });

    const counts = users.reduce((acc, u) => {

      const s = String(
        u.status || "NONE"
      ).toUpperCase();

      acc[s] = (acc[s] || 0) + 1;

      return acc;

    }, {});

    return json(200, {
      ok: true,
      count: users.length,
      counts,
      users
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
      "Content-Type":
        "application/json; charset=utf-8",

      "Access-Control-Allow-Origin": "*",

      "Access-Control-Allow-Headers":
        "Content-Type",

      "Access-Control-Allow-Methods":
        "POST, OPTIONS",

      "Cache-Control": "no-store"
    },

    body: JSON.stringify(obj)
  };
}
