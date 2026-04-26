const { getStore } = require("@netlify/blobs");

exports.handler = async (event) => {
  try {
    if (event.httpMethod !== "POST") {
      return json(405, { ok: false, error: "Method not allowed" });
    }

    const body = JSON.parse(event.body || "{}");
    const email = String(body.email || "").trim().toLowerCase();
    const plan = String(body.plan || "").trim();
    const paymentTitle = String(body.paymentTitle || "").trim();

    if (!email || !plan) {
      return json(400, { ok: false, error: "Missing email or plan" });
    }

    let ms = 0;
    if (plan === "24h") ms = 24 * 60 * 60 * 1000;
    if (plan === "7d") ms = 7 * 24 * 60 * 60 * 1000;
    if (plan === "30d") ms = 30 * 24 * 60 * 60 * 1000;

    if (!ms) {
      return json(400, { ok: false, error: "Invalid plan" });
    }

    const now = Date.now();
    const expires = now + ms;

    try {
  const store = getStore("sb-users");

  await store.set(email, JSON.stringify({
    email,
    plan,
    paymentTitle,
    status: "ACTIVE",
    createdAt: now,
    expires
  }));
} catch (blobError) {
  console.log("Blobs save skipped:", blobError.message || blobError);
}

await sendNotificationEmail({
  email,
  plan,
  paymentTitle,
  createdAt: now,
  expires
});

    return json(200, {
      ok: true,
      email,
      plan,
      paymentTitle,
      status: "ACTIVE",
      expires
    });
  } catch (e) {
    return json(500, { ok: false, error: e.message || String(e) });
  }
};

async function sendNotificationEmail({ email, plan, paymentTitle, createdAt, expires }) {
  if (!process.env.RESEND_API_KEY) return;

  await fetch("https://api.resend.com/emails", {
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
        <p><b>Email:</b> ${email}</p>
        <p><b>Plan:</b> ${plan}</p>
        <p><b>Tytuł przelewu:</b> ${paymentTitle || "-"}</p>
        <p><b>Aktywacja:</b> ${new Date(createdAt).toLocaleString("pl-PL")}</p>
        <p><b>Ważne do:</b> ${new Date(expires).toLocaleString("pl-PL")}</p>
      `
    })
  });
}

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
