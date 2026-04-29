const { getStore } = require("@netlify/blobs");

exports.handler = async (event) => {
  try {
    if (event.httpMethod !== "POST") {
      return json(405, { ok: false, error: "Method not allowed" });
    }

    const body = JSON.parse(event.body || "{}");
    const adminPin = String(body.adminPin || "").trim();

    if (adminPin !== process.env.ADMIN_PIN) {
      return json(403, { ok: false, error: "Wrong admin PIN" });
    }

    const store = getStore("sb-users");
    const list = await store.list();

    const users = [];

    for (const item of list.blobs || []) {
      const email = item.key;
      const raw = await store.get(email);

      if (!raw) continue;

      let data = {};
      try {
        data = JSON.parse(raw);
      } catch {
        data = {};
      }

      const now = Date.now();
      let status = data.status || "NONE";

      if (status === "ACTIVE" && data.expires && now > Number(data.expires)) {
        status = "EXPIRED";
      }

      users.push({
        email,
        status,
        plan: data.plan || "-",
        expires: data.expires
          ? new Date(Number(data.expires)).toLocaleString("nl-NL")
          : "-",
        rawExpires: data.expires || null,
        last: data.last || data.paymentTitle || "-"
      });
    }

    users.sort((a, b) => {
      const order = { PENDING: 1, ACTIVE: 2, BLOCKED: 3, EXPIRED: 4, NONE: 5 };
      return (order[a.status] || 9) - (order[b.status] || 9);
    });

    return json(200, {
      ok: true,
      count: users.length,
      users
    });

  } catch (e) {
    return json(500, {
      ok: false,
      error: e.message || String(e)
    });
  }
};

function json(statusCode, data) {
  return {
    statusCode,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*"
    },
    body: JSON.stringify(data)
  };
}
