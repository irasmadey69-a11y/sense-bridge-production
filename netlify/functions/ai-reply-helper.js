// Sense Bridge AI Tools — reply-helper
// Production Netlify Function
// CommonJS
// Dual-language answer layer: user understands what they send/say.

exports.handler = async (event) => {
  const headers = corsHeaders();

  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 200, headers, body: "" };
  }

  try {
    const body = safeJson(event.body);
    const input = str(body.input || body.text || body.content || "");
    const uiLang = str(body.uiLang || body.userLang || body.language || "PL").toUpperCase();

    if (!input) {
      return json(400, headers, {
        ok: false,
        error: "No input provided",
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

Main rule:
The user must understand what they are going to send or say.
Do not only generate a foreign-language text.
Always provide:
1) explanation in the user's interface language: ${uiLang}
2) ready-to-copy text in the recipient/institution language, detected from the input when possible.

Supported interface languages: PL, UA, NL, EN, DE, FR, IT, ES, PT.

Detect:
- inputLanguage: language of the pasted message / situation
- recipientLanguage: likely language the reply or spoken phrases should be in
If uncertain, use the input language as recipientLanguage.

Never give legal advice. Use calm, simple language.
Do not claim certainty. Do not invent official facts.
If the situation looks risky, tell the user to verify through an official channel.

Format the answer clearly with these exact section style labels, translated naturally to the user's interface language when possible:

📄 Detected language
A short line with detected language and target reply/speech language.

📖 What this means
Explain in the user's language what the user is replying to / preparing for.

🧭 What to do next
2-4 short practical steps in the user's language.

✍️ Draft in your language
A clear draft in the user's interface language so they understand the meaning.

🌍 Ready text to send/say
The same meaning in the recipient/institution language, ready to copy.

⚠️ Check before sending
A short caution in the user's language: verify names, dates, amounts, personal data before sending.

Tool: reply-helper

Task:
Help the user respond to a message, office letter, company email, SMS, employer message or institution request. Create a safe, calm reply. Provide both the meaning in the user's language and a ready-to-send version in the recipient language.

User content:
${input}
`.trim();

    const result = await callOpenAIText(apiKey, prompt);

    return json(200, headers, {
      ok: true,
      tool: "reply-helper",
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
    PL: "Brak treści do analizy.",
    EN: "No content to analyze.",
    NL: "Geen inhoud om te analyseren.",
    DE: "Kein Inhalt zur Analyse.",
    UA: "Немає вмісту для аналізу.",
    FR: "Aucun contenu à analyser.",
    IT: "Nessun contenuto da analizzare.",
    ES: "No hay contenido para analizar.",
    PT: "Não há conteúdo para analisar."
  };
  return map[L] || map.PL;
}

async function callOpenAIText(apiKey, prompt) {
  const res = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${apiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model: "gpt-4o-mini",
      temperature: 0.2,
      max_output_tokens: 1600,
      input: prompt
    })
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`OpenAI error ${res.status}: ${JSON.stringify(data)}`);

  const text =
    data.output_text ||
    (Array.isArray(data.output)
      ? data.output.flatMap(o => o.content || []).map(c => c.text || "").join("\n")
      : "");

  return String(text || "").trim();
}
