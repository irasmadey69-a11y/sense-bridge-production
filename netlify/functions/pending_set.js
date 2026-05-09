const { getStore, connectLambda } = require("@netlify/blobs");

exports.handler = async (event) => {
  try {
    connectLambda(event);

    if (event.httpMethod !== "POST") {
      return json(405, { ok: false, error: "Method not allowed" });
    }

    const body = JSON.parse(event.body || "{}");

    const email = String(body.email || "").trim().toLowerCase();
    const plan = String(body.plan || "—").trim();
    const paymentTitle = String(body.paymentTitle || "").trim();

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

    // Jeśli user już istnieje
    if (raw) {
      const existing = JSON.parse(raw);

      // Nie ruszaj aktywnego lub zablokowanego
      if (existing.status === "ACTIVE" || existing.status === "BLOCKED") {
        return json(200, {
          ok: true,
          status: existing.status,
          message: "User already active or blocked"
        });
      }

      // Jeśli już PENDING — odśwież dane
      if (existing.status === "PENDING") {
        existing.createdAt = now;
        existing.last = "Ponownie kliknięto Zapłaciłem";
        existing.plan = plan || existing.plan;
        existing.paymentTitle = paymentTitle || existing.paymentTitle;

        await store.set(email, JSON.stringify(existing));

        return json(200, {
          ok: true,
          status: "PENDING",
          message: "Pending refreshed"
        });
      }
    }

    // Nowy user
    const userData = {
      email,
      status: "PENDING",
      plan,
      paymentTitle,
      createdAt: now,
      last: "Kliknięto Zapłaciłem"
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
