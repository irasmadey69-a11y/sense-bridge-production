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

    if (raw) {
      const existing = JSON.parse(raw);

      if (existing.status === "ACTIVE" || existing.status === "BLOCKED") {
        return json(200, {
          ok: true,
          status: existing.status,
          message: "User already active or blocked"
        });
      }

      if (existing.status === "PENDING") {
        existing.createdAt = now;
        existing.last = "Ponownie kliknięto Zapłaciłem";
        existing.plan = plan || existing.plan;
        existing.paymentTitle = paymentTitle || existing.paymentTitle;

        await store.set(email, JSON.stringify(existing));

        await sendPendingEmail({
          email,
          plan: existing.plan,
          paymentTitle: existing.paymentTitle,
          createdAt: now,
          repeated: true
        });

        return json(200, {
          ok: true,
          status: "PENDING",
          message: "Pending refreshed"
        });
      }
    }

    const userData = {
      email,
      status: "PENDING",
      plan,
      paymentTitle,
      createdAt: now,
      last: "Kliknięto Zapłaciłem"
    };

    await store.set(email, JSON.stringify(userData));

    await sendPendingEmail({
      email,
      plan,
      paymentTitle,
      createdAt: now,
      repeated: false
    });

    return json(200, {
      ok: true,
      status: "PENDING"
    });

  } catch (e) {
    return json(500, { ok: false, error: e.message || String(e) });
  }
};

async function sendPendingEmail({ email, plan, paymentTitle, createdAt, repeated }) {
  if (!process.env.RESEND_API_KEY) return;

  const subject = repeated
    ? "Ponowne zgłoszenie płatności Sense Bridge"
    : "Nowe zgłoszenie płatności Sense Bridge";

  await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      "Authorization": "Bearer " + process.env.RESEND_API_KEY,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      from: "Sense Bridge <onboarding@resend.dev>",
      to: ["madey.verpakken@gmail.com"],
      subject,
      html: `
        <h2>${subject}</h2>
        <p><b>Status:</b> PENDING</p>
        <p><b>Email użytkownika:</b> ${escapeHtml(email)}</p>
        <p><b>Plan:</b> ${escapeHtml(plan || "—")}</p>
        <p><b>Tytuł przelewu / kod:</b> ${escapeHtml(paymentTitle || "—")}</p>
        <p><b>Kliknięto:</b> ${new Date(createdAt).toLocaleString("pl-PL")}</p>
        <hr>
        <p>Sprawdź konto bankowe. Jeśli przelew się zgadza, aktywuj użytkownika w panelu admina.</p>
      `
    })
  });
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
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Headers": "Content-Type",
      "Access-Control-Allow-Methods": "POST, OPTIONS"
    },
    body: JSON.stringify(obj)
  };
}
