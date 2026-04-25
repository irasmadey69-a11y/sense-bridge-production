export async function handler(event) {
  try {
    const body = JSON.parse(event.body || "{}");
    const email = (body.email || "").toLowerCase().trim();

    if (!email) {
      return {
        statusCode: 400,
        body: JSON.stringify({ ok: false, error: "Missing email" })
      };
    }

    const store = getStore("sb-users");
    const raw = await store.get(email);

    if (!raw) {
      return {
        statusCode: 200,
        body: JSON.stringify({ ok: true, access: "NONE" })
      };
    }

    const user = JSON.parse(raw);

    const now = Date.now();

    if (user.status === "BLOCKED") {
      return {
        statusCode: 200,
        body: JSON.stringify({ ok: true, access: "BLOCKED" })
      };
    }

    if (user.expires && now > user.expires) {
      return {
        statusCode: 200,
        body: JSON.stringify({ ok: true, access: "EXPIRED" })
      };
    }

    return {
      statusCode: 200,
      body: JSON.stringify({
        ok: true,
        access: "ACTIVE",
        plan: user.plan,
        expires: user.expires
      })
    };

  } catch (e) {
    return {
      statusCode: 500,
      body: JSON.stringify({ ok: false, error: e.message })
    };
  }
}
