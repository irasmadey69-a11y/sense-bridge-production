const { getStore, connectLambda } = require("@netlify/blobs");

exports.handler = async (event) => {
  const method = String(event?.httpMethod || "").toUpperCase();

  if (method === "OPTIONS") {
    return json(200, { ok: true });
  }

  if (method !== "POST") {
    return json(405, { ok: false, error: "Method not allowed" });
  }

  try {
    connectLambda(event);

    const body = safeJson(event.body);
    if (!body) {
      return json(400, { ok: false, error: "Invalid JSON body" });
    }

    const email = String(body.email || "").trim().toLowerCase();
    const plan = String(body.plan || "").trim();
    const paymentTitle = String(body.paymentTitle || "").trim();

    if (!email || !plan) {
      return json(400, { ok: false, error: "Missing email or plan" });
    }

    const planDurations = {
      "24h": 24 * 60 * 60 * 1000,
      "7d": 7 * 24 * 60 * 60 * 1000,
      "30d": 30 * 24 * 60 * 60 * 1000,
      "30d-pro": 30 * 24 * 60 * 60 * 1000
    };

    const ms = planDurations[plan] || 0;

    if (!ms) {
      return json(400, { ok: false, error: "Invalid plan" });
    }

    const now = Date.now();
    const expires = now + ms;

    const store = getStore({
      name: "sb-users",
      siteID: process.env.NETLIFY_SITE_ID,
      token: process.env.NETLIFY_AUTH_TOKEN
    });

    // Zachowujemy dotychczasową logikę:
    // PIN jest sprawdzany tylko wtedy, gdy został przesłany.
    const adminPin = String(body.adminPin || "");
    const isAdmin = Boolean(
      adminPin &&
      process.env.ADMIN_PIN &&
      adminPin === process.env.ADMIN_PIN
    );

    const existingRaw = await store.get(email);

    if (existingRaw) {
      const existing = safeJson(existingRaw);

      if (!existing || typeof existing !== "object") {
        return json(500, {
          ok: false,
          error: "Invalid user access record"
        });
      }

      // Zablokowany użytkownik nie może sam się aktywować.
      // Administrator z poprawnym PIN-em nadal może go odblokować aktywacją.
      const existingStatus = String(existing.status || "").trim().toUpperCase();

      if (existingStatus === "BLOCKED" && !isAdmin) {
        return json(403, {
          ok: false,
          error: "Ten email jest zablokowany."
        });
      }
    }

    // Zachowujemy dotychczasowe nadpisanie rekordu użytkownika.
    const isPro = plan === "30d-pro";
    const accessType = isPro ? "PRO" : "BASIC";
    const aiLimits = { "24h": 3, "7d": 15, "30d": 40, "30d-pro": 100 };
    const aiLimit = aiLimits[plan] || 2;

    await store.set(email, JSON.stringify({
      email,
      plan,
      accessType,
      aiLimit,
      paymentTitle,
      status: "ACTIVE",
      createdAt: now,
      expires
    }));

    // Błąd wysłania maila nie może cofnąć poprawnie zapisanej aktywacji.
    const mailResult = await sendNotificationEmail({
      email,
      plan,
      paymentTitle,
      aiLimit,
      createdAt: now,
      expires
    });

    return json(200, {
      ok: true,
      email,
      plan,
      paymentTitle,
      status: "ACTIVE",
      accessType: plan === "30d-pro" ? "PRO" : "BASIC",
      aiLimit,
      expires,
      emailSent: mailResult.sent,
      emailError: mailResult.error || null
    });

  } catch (e) {
    console.error("access_set error:", e);

    return json(500, {
      ok: false,
      error: e?.message || String(e)
    });
  }
};

async function sendNotificationEmail({ email, plan, paymentTitle, aiLimit, createdAt, expires }) {
  if (!process.env.RESEND_API_KEY) {
    return {
      sent: false,
      error: "Missing RESEND_API_KEY"
    };
  }

  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "Authorization": "Bearer " + process.env.RESEND_API_KEY,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        from: "Sense Bridge <onboarding@resend.dev>",
        to: ["madey.verpakken@gmail.com"],
        subject: "Nowa aktywacja Sense Bridge",
        html: `
          <h2>Nowa aktywacja Sense Bridge</h2>
          <p><b>Email:</b> ${escapeHtml(email)}</p>
          <p><b>Plan:</b> ${escapeHtml(plan)}</p>
          <p><b>Typ dostępu:</b> ${plan === "30d-pro" ? "PRO" : "BASIC"}</p>
          <p><b>Dodatkowy limit narzędzi AI:</b> ${aiLimit}</p>
          <p><b>Tytuł przelewu:</b> ${escapeHtml(paymentTitle || "-")}</p>
          <p><b>Aktywacja:</b> ${new Date(createdAt).toLocaleString("pl-PL")}</p>
          <p><b>Ważne do:</b> ${new Date(expires).toLocaleString("pl-PL")}</p>
        `
      })
    });

    const responseText = await res.text();

    if (!res.ok) {
      return {
        sent: false,
        error: "Resend error " + res.status + ": " + responseText
      };
    }

    return {
      sent: true,
      error: null
    };
  } catch (e) {
    return {
      sent: false,
      error: e?.message || String(e)
    };
  }
}

function safeJson(value) {
  try {
    if (value && typeof value === "object") return value;
    return JSON.parse(value || "{}");
  } catch {
    return null;
  }
}

function escapeHtml(str) {
  return String(str ?? "").replace(/[&<>"']/g, (s) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  }[s]));
}

function json(statusCode, obj) {
  return {
    statusCode,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Headers": "Content-Type",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Cache-Control": "no-store"
    },
    body: JSON.stringify(obj)
  };
}
