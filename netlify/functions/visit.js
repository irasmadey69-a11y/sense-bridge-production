const { getStore } = require("@netlify/blobs");

exports.handler = async (event) => {
  try {
    if (event.httpMethod !== "POST") {
      return json(405, { ok:false, error:"Method not allowed" });
    }

    if (event.headers["x-sb-event"] !== "visit") {
      return json(403, { ok:false, error:"Wrong event" });
    }

    const store = getStore({
      name: "sb-stats",
      siteID: process.env.NETLIFY_SITE_ID,
      token: process.env.NETLIFY_AUTH_TOKEN
    });

    let count = await store.get("visits");
    count = count ? parseInt(count, 10) : 0;
    count++;

    await store.set("visits", String(count));

    return json(200, { ok:true, visits:count });
  } catch(e) {
    return json(500, { ok:false, error:e.message });
  }
};

function json(statusCode, body){
  return {
    statusCode,
    headers:{ "Content-Type":"application/json; charset=utf-8" },
    body:JSON.stringify(body)
  };
}
