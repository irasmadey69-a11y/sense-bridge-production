// netlify/functions/translate.js
exports.handler = async (event) => {
  const headers = corsHeaders();

  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 200, headers, body: "" };
  }

  try {
    const body = safeJson(event.body);
    const text = str(body.text || body.input || body.content || "");
    const sourceLang = str(body.sourceLang || body.source || "AUTO").toUpperCase();
    const targetLang = str(body.userLang || body.targetLang || body.target || "PL").toUpperCase();

    if (!text) {
      return json(200, headers, { ok: true, detectedLang: "UNKNOWN", translation: "" });
    }

    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      return json(500, headers, { ok: false, error: "Brak OPENAI_API_KEY w Netlify env." });
    }

    const prompt = `
Przetłumacz poniższy tekst na język: ${targetLang}.
Jeśli sourceLang != AUTO, to tekst jest w języku: ${sourceLang}.
Zachowaj format, sens i ton.
Zwróć WYŁĄCZNIE tłumaczenie.

TEKST:
"""${text}"""
`.trim();

    const translation = await callOpenAIText(apiKey, prompt);

    return json(200, headers, {
      ok: true,
      detectedLang: (sourceLang && sourceLang !== "AUTO") ? sourceLang : "AUTO",
      translation,
      translatedText: translation,
      translated: translation
    });
  } catch (err) {
    return json(500, corsHeaders(), { ok: false, error: String(err?.message || err) });
  }
};

/* helpers */
function corsHeaders() {
  return {
    "Content-Type": "application/json; charset=utf-8",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Cache-Control": "no-store"
  };
}
function json(statusCode, headers, obj) {
  return { statusCode, headers, body: JSON.stringify(obj) };
}
function safeJson(s) { try { return s ? JSON.parse(s) : {}; } catch { return {}; } }
function str(v) { return (typeof v === "string" ? v : "").trim(); }

async function callOpenAIText(apiKey, prompt) {
  const res = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${apiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model: "gpt-4o-mini",
      temperature: 0,
      max_output_tokens: 1400,
      input: prompt,
      text: { format: { type: "text" } }
    })
  });

  const data = await res.json();
  if (!res.ok) throw new Error(`OpenAI error ${res.status}: ${JSON.stringify(data)}`);

  if (typeof data?.output_text === "string" && data.output_text.trim()) return data.output_text;
  const out = data?.output;
  if (Array.isArray(out)) {
    for (const item of out) {
      const content = item?.content;
      if (Array.isArray(content)) {
        for (const c of content) {
          const t = c?.text;
          if (typeof t === "string" && t.trim()) return t;
        }
      }
    }
  }
  return "";
}