// Sense Bridge AI Tools — screenshot vision check
// Production Netlify Function
// CommonJS
// Accepts text input and optional imageData (data:image/...;base64,...)

exports.handler = async (event) => {
  const headers = corsHeaders();

  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 200, headers, body: "" };
  }

  try {
    const body = safeJson(event.body);
    const input = str(body.input || body.text || body.content || "");
    const imageData = str(body.imageData || body.image || "");
    const uiLang = str(body.uiLang || body.userLang || body.language || "PL").toUpperCase();

    if (!input && !imageData) {
      return json(400, headers, {
        ok: false,
        error: "No input or image provided",
        result: emptyText(uiLang)
      });
    }

    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      return json(500, headers, {
        ok: false,
        error: "Missing OPENAI_API_KEY"
      });
    }

    const prompt = `
You are Sense Bridge.

Task:
Analyze a screenshot or image from a user. The image may show:
- a warning message
- a fake virus alert
- a banking/login screen
- a payment request
- an advertisement
- a suspicious notification
- a message from an app, office, delivery company, bank or unknown sender.

Respond in the user's interface language: ${uiLang}.

Rules:
- Be practical and calm.
- Do not identify private people.
- Do not claim certainty if the image is unclear.
- If it looks like phishing/scam, say clearly not to click links, not to enter passwords, SMS/TAN codes, bank details or personal data.
- If it appears legitimate, still suggest verifying through the official app/site when money, login or personal data is involved.
- Never give legal advice.

Return a concise, useful answer with these sections, translated naturally into the user's interface language:

✅ What I can see
Describe the visible screen/message.

⚠️ Risk
Low / medium / high risk and why.

🧭 What to do next
Give 3-5 concrete safe steps.

✍️ Useful wording
If relevant, provide a short message the user can send to ask whether it is real.

User extra description:
${input || "(no extra text)"}
`.trim();

    const content = [
      { type: "input_text", text: prompt }
    ];

    if (imageData && imageData.startsWith("data:image/")) {
      content.push({
        type: "input_image",
        image_url: imageData
      });
    } else if (imageData) {
      content.push({
        type: "input_text",
        text: "The user attached an image, but it was not in a readable data:image format."
      });
    }

    const result = await callOpenAIVision(apiKey, content);

    return json(200, headers, {
      ok: true,
      tool: "screenshot",
      uiLang,
      result
    });

  } catch (err) {
    return json(500, headers, {
      ok: false,
      error: String(err && err.message ? err.message : err)
    });
  }
};

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

function safeJson(s) {
  try { return s ? JSON.parse(s) : {}; } catch { return {}; }
}

function str(v) {
  return (typeof v === "string" ? v : "").trim();
}

function emptyText(lang) {
  const L = (lang || "PL").toUpperCase();
  const map = {
    PL: "Brak treści lub obrazu do analizy.",
    EN: "No content or image to analyze.",
    NL: "Geen inhoud of afbeelding om te analyseren.",
    DE: "Kein Inhalt oder Bild zur Analyse.",
    UA: "Немає вмісту або зображення для аналізу.",
    FR: "Aucun contenu ou image à analyser.",
    IT: "Nessun contenuto o immagine da analizzare.",
    ES: "No hay contenido o imagen para analizar.",
    PT: "Não há conteúdo ou imagem para analisar."
  };
  return map[L] || map.PL;
}

async function callOpenAIVision(apiKey, content) {
  const res = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${apiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model: "gpt-4o-mini",
      temperature: 0.2,
      max_output_tokens: 1500,
      input: [
        {
          role: "user",
          content
        }
      ]
    })
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(`OpenAI error ${res.status}: ${JSON.stringify(data)}`);
  }

  const text =
    data.output_text ||
    (Array.isArray(data.output)
      ? data.output.flatMap(o => o.content || []).map(c => c.text || "").join("\n")
      : "");

  return String(text || "").trim();
}
