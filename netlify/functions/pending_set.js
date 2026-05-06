const { getStore, connectLambda } = require("@netlify/blobs");

exports.handler = async (event) => {
  try {
    connectLambda(event);

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

    const now = Date.now();

    const raw = await store.get(email);

    // 👉 jeśli user już istnieje
    if (raw) {
      const existing = JSON.parse(raw);

      // 🔴 NIE RUSZAJ aktywnego lub zablokowanego
      if (existing.status === "ACTIVE" || existing.status === "BLOCKED") {
        return json(200, {
          ok: true,
          status: existing.status,
          message: "User already active or blocked"
        });
      }

      // 🟡 jeśli już PENDING → tylko odśwież czas
      if (existing.status === "PENDING") {
        existing.createdAt = now;
        existing.last = "Ponownie kliknięto 'Zapłaciłem'";

        await store.set(email, JSON.stringify(existing));

        return json(200, {
          ok: true,
          status: "PENDING",
          message: "Pending refreshed"
        });
      }
    }

    // 🆕 nowy user
    const userData = {
      email,
      status: "PENDING",
      plan: "—",
      createdAt: now,
      last: "Kliknięto 'Zapłaciłem'"
    };

    await store.set(email, JSON.stringify(userData));

    return json(200, {
      ok: true,
      status: "PENDING"
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