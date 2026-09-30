const crypto = require("crypto");
const { getStore, connectLambda } = require("@netlify/blobs");

const REVIEW_EMAIL = "google-play-review@sensebridge.internal";
const REVIEW_PLAN = "review";
const REVIEW_ACCESS_DAYS = 730;

exports.handler = async (event) => {
  try {
    connectLambda(event);

    if (event.httpMethod !== "POST") {
      return json(405, { ok: false, error: "Method not allowed" });
    }

    const configuredToken = String(process.env.REVIEW_ACCESS_TOKEN || "");
    if (!configuredToken) {
      return json(503, {
        ok: false,
        error: "Review access is not configured"
      });
    }

    const body = JSON.parse(event.body || "{}");
    const suppliedToken = String(body.token || "");

    if (!safeEqual(suppliedToken, configuredToken)) {
      return json(403, {
        ok: false,
        error: "Invalid review token"
      });
    }

    const now = Date.now();
    const expires = now + REVIEW_ACCESS_DAYS * 24 * 60 * 60 * 1000;

    const store = getStore({
      name: "sb-users",
      siteID: process.env.NETLIFY_SITE_ID,
      token: process.env.NETLIFY_AUTH_TOKEN
    });

    await store.set(REVIEW_EMAIL, JSON.stringify({
      email: REVIEW_EMAIL,
      plan: REVIEW_PLAN,
      paymentTitle: "GOOGLE_PLAY_REVIEW",
      status: "ACTIVE",
      createdAt: now,
      expires,
      reviewAccess: true
    }));

    return json(200, {
      ok: true,
      email: REVIEW_EMAIL,
      plan: REVIEW_PLAN,
      status: "ACTIVE",
      expires
    });

  } catch (e) {
    return json(500, {
      ok: false,
      error: e.message || String(e)
    });
  }
};

function safeEqual(a, b) {
  const aBuffer = Buffer.from(String(a), "utf8");
  const bBuffer = Buffer.from(String(b), "utf8");

  if (aBuffer.length !== bBuffer.length) {
    return false;
  }

  return crypto.timingSafeEqual(aBuffer, bBuffer);
}

function json(statusCode, obj) {
  return {
    statusCode,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
      "Cache-Control": "no-store"
    },
    body: JSON.stringify(obj)
  };
}
