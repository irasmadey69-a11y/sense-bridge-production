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

    const paymentsStore = getStore({
  name: "sb-payments",
  siteID: process.env.NETLIFY_SITE_ID,
  token: process.env.NETLIFY_AUTH_TOKEN
});

    const now = Date.now();

const paymentRecord = {
  email,
  plan,
  paymentTitle,
  createdAt: now
};

await paymentsStore.set(
  `${now}_${email}`,
  JSON.stringify(paymentRecord)
);

const raw = await store.get(email);

    let repeated = false;
    let finalStatus = "PENDING";
    let savedPlan = plan;
    let savedPaymentTitle = paymentTitle;

    if (raw) {
      const existing = JSON.parse(raw);
      const existingStatus = String(existing.status || "").toUpperCase();

      // Jeśli użytkownik jest BLOCKED, nie przyjmujemy zgłoszenia.
      if (existingStatus === "BLOCKED") {
        return json(200, {
          ok: true,
          status: "BLOCKED",
          emailSent: false,
          message: "User is blocked"
        });
      }

      // Jeśli użytkownik jest ACTIVE, nie zmieniamy dostępu,
      // ale nadal wysyłamy mail informacyjny, że kliknął Zapłaciłem.
      if (existingStatus === "ACTIVE") {
        const mailResult = await sendPendingEmail({
          email,
          plan: plan || existing.plan || "—",
          paymentTitle: paymentTitle || existing.paymentTitle || existing.paymentCode || "—",
          createdAt: now,
          repeated: true,
          note: "Użytkownik ma już ACTIVE, ale ponownie kliknął Zapłaciłem."
        });

        return json(200, {
          ok: true,
          status: "ACTIVE",
          emailSent: mailResult.sent,
          emailError: mailResult.error || null,
          message: "User already active; notification attempted"
        });
      }

      // Jeśli już PENDING — odświeżamy dane.
      if (existingStatus === "PENDING") {
        repeated = true;

        existing.createdAt = now;
        existing.last = "Ponownie kliknięto Zapłaciłem";
        existing.plan = plan || existing.plan || "—";
        existing.paymentTitle = paymentTitle || existing.paymentTitle || "—";

        savedPlan = existing.plan;
        savedPaymentTitle = existing.paymentTitle;

        await store.set(email, JSON.stringify(existing));
      } else {
        // Jeśli był EXPIRED / NONE / inny status — ustawiamy PENDING.
        const userData = {
          ...existing,
          email,
          status: "PENDING",
          plan: savedPlan,
          paymentTitle: savedPaymentTitle,
          createdAt: now,
          last: "Kliknięto Zapłaciłem"
        };

        await store.set(email, JSON.stringify(userData));
      }

    } else {
      // Nowy użytkownik
      const userData = {
        email,
        status: "PENDING",
        plan: savedPlan,
        paymentTitle: savedPaymentTitle,
        createdAt: now,
        last: "Kliknięto Zapłaciłem"
      };

      await store.set(email, JSON.stringify(userData));
    }

    const mailResult = await sendPendingEmail({
      email,
      plan: savedPlan,
      paymentTitle: savedPaymentTitle,
      createdAt: now,
      repeated,
      note: "Nowe zgłoszenie PENDING po kliknięciu Zapłaciłem."
    });

    return json(200, {
      ok: true,
      status: finalStatus,
      emailSent: mailResult.sent,
      emailError: mailResult.error || null
    });

  } catch (e) {
    return json(500, {
      ok: false,
      error: e.message || String(e)
    });
  }
};

async function sendPendingEmail({ email, plan, paymentTitle, createdAt, repeated, note }) {
  if (!process.env.RESEND_API_KEY) {
    return {
      sent: false,
      error: "Missing RESEND_API_KEY"
    };
  }

  const subject = repeated
    ? "Ponowne zgłoszenie płatności Sense Bridge"
    : "Nowe zgłoszenie płatności Sense Bridge";

  const payload = {
    from: "Sense Bridge <onboarding@resend.dev>",
    to: ["madey.verpakken@gmail.com"],
    subject,
    html: `
      <h2>${escapeHtml(subject)}</h2>
      <p><b>Status:</b> PENDING</p>
      <p><b>Email użytkownika:</b> ${escapeHtml(email)}</p>
      <p><b>Plan:</b> ${escapeHtml(plan || "—")}</p>
      <p><b>Tytuł przelewu / kod:</b> ${escapeHtml(paymentTitle || "—")}</p>
      <p><b>Kliknięto:</b> ${new Date(createdAt).toLocaleString("pl-PL")}</p>
      <p><b>Notatka:</b> ${escapeHtml(note || "—")}</p>
      <hr>
      <p>Sprawdź konto bankowe. Jeśli przelew się zgadza, aktywuj użytkownika w panelu admina.</p>
    `
  };

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      "Authorization": "Bearer " + process.env.RESEND_API_KEY,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(payload)
  });

  const txt = await res.text();

  if (!res.ok) {
    return {
      sent: false,
      error: "Resend error " + res.status + ": " + txt
    };
  }

  return {
    sent: true,
    error: null
  };
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
