const {getStore,connectLambda}=require('@netlify/blobs');
const {increment,incrementMap}=require('./_atomic-stats');
const { recordUsage } = require("./_usage");
exports.handler = async (event, context) => {
  try {
    if (event.httpMethod !== "POST") {
      return json(405, { ok: false, error: "Method not allowed" });
    }

    const body = JSON.parse(event.body || "{}");
    const { imageDataUrl } = body;
    const uiLang = String(body.uiLang || body.userLang || "UNKNOWN").toUpperCase();
    const accessType = String(body.accessType || "UNKNOWN").toUpperCase();

    if (!imageDataUrl || !String(imageDataUrl).startsWith("data:image/")) {
      return json(400, { ok: false, error: "Missing image" });
    }

    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      return json(500, { ok: false, error: "Missing OPENAI_API_KEY" });
    }

    const response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: process.env.OCR_MODEL || "gpt-4.1-mini",
        input: [
          {
            role: "user",
            content: [
              {
                type: "input_text",
                text:
                  "Odczytaj tekst z tego zdjęcia pisma. Zwróć tylko czysty tekst. Nie analizuj, nie tłumacz, nie dodawaj komentarzy."
              },
              {
                type: "input_image",
                image_url: imageDataUrl
              }
            ]
          }
        ]
      })
    });

    const data = await response.json();

    if (!response.ok) {
      return json(500, {
        ok: false,
        error: data?.error?.message || "OpenAI OCR error"
      });
    }

    await recordUsage(event, context, data, { feature:"OCR", uiLang, documentLang:"UNKNOWN", accessType, model:data.model || process.env.OCR_MODEL || "gpt-4.1-mini" });

    const text =
      data.output_text ||
      data.output?.[0]?.content?.[0]?.text ||
      "";

    if(data.status==='incomplete')return json(502,{ok:false,error:'Incomplete OCR result'});
    if(body.countOCR===true && String(text||'').trim()) {
      try {
        connectLambda(event);
        const store=getStore({name:'sb-stats',siteID:process.env.NETLIFY_SITE_ID,token:process.env.NETLIFY_AUTH_TOKEN});
        const h=event.headers||{};
        const country=h['x-nf-country']||h['X-Nf-Country']||context?.geo?.country?.code||'UNKNOWN';
        await increment(store,'ocr_use');
        await incrementMap(store,'geo_ocr_use',country);
        await incrementMap(store,'lang_ocr_use',uiLang);
      }catch(e){console.error('OCR statistics error',e);}
    }
    return json(200,{ok:true,text:String(text||'').trim()});
  } catch (err) {
    return json(500, { ok: false, error: err.message || "Server error" });
  }
};

function json(statusCode, body) {
  return {
    statusCode,
    headers: {
      "Content-Type": "application/json; charset=utf-8"
    },
    body: JSON.stringify(body)
  };
}
