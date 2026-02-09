// netlify/functions/analyze.js  (CommonJS)

exports.handler = async (event) => {
  const headers = corsHeaders();

  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 200, headers, body: "" };
  }

  try {
    const body = safeJson(event.body);
    const text = str(body.text || body.input || body.content || body.document || "");
    const sourceLang = str(body.sourceLang || body.source || "AUTO").toUpperCase(); // AUTO | NL | DE | EN | PL
    const userLang = str(body.userLang || body.targetLang || body.target || "PL").toUpperCase(); // PL | DE | NL | EN
    const tone = str(body.tone || body.style || "neutral").toLowerCase();

    if (!text) {
      return json(200, headers, {
        ok: true,
        detectedLang: "UNKNOWN",
        summary: "Brak tekstu do analizy.",
        risks: [],
        replies: buildReplies(userLang, tone),
        examples: buildReplies(userLang, tone),
        translation: ""
      });
    }

    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      return json(500, headers, {
        ok: false,
        error: "Brak OPENAI_API_KEY w zmiennych środowiskowych Netlify."
      });
    }

    // 1) ANALIZA (JSON)
    const analysisPrompt = `
Zadanie: przeanalizuj pismo (bez porad prawnych). Zależy mi na:
1) Wykryciu języka pisma (detectedLang).
2) Krótkim streszczeniu "co urząd komunikuje" (1-3 zdania) w języku: ${userLang}.
3) "Ryzyka komunikacyjne" (3-8 punktów).
4) 3 wersje gotowej odpowiedzi: neutralna, uprzejma, stanowcza (w języku: ${userLang}).

Zwróć WYŁĄCZNIE JSON:
{
  "detectedLang": "NL",
  "summary": "...",
  "risks": ["...", "..."],
  "replies": { "neutral": "...", "polite": "...", "firm": "..." }
}

Tekst:
"""${text}"""
`.trim();

    const modelJson = await callOpenAIJson(apiKey, analysisPrompt);

    const detectedLang = str(modelJson.detectedLang || "UNKNOWN").toUpperCase();
    const summary = str(modelJson.summary || "");
    const risks = Array.isArray(modelJson.risks) ? modelJson.risks.filter(Boolean).map(String) : [];
    const repliesFromModel = (modelJson.replies && typeof modelJson.replies === "object") ? modelJson.replies : {};

    // 2) TŁUMACZENIE (tekst) — zawsze zwracamy "translation"
    const effectiveSource = (sourceLang === "AUTO" ? detectedLang : sourceLang) || "UNKNOWN";

    let translation = "";
    if (effectiveSource === userLang || userLang === "AUTO") {
      translation = text;
    } else {
      const translatePrompt = `
Przetłumacz poniższy tekst na język: ${userLang}.
Zachowaj sens, ton i format (np. akapity, listy).
Zwróć WYŁĄCZNIE przetłumaczony tekst, bez komentarzy.

TEKST:
"""${text}"""
`.trim();
      translation = await callOpenAIText(apiKey, translatePrompt);
    }

    // Fallback odpowiedzi
    const fallbackReplies = buildReplies(userLang, tone);

    const replies = {
      neutral: str(repliesFromModel.neutral || fallbackReplies.neutral),
      polite:  str(repliesFromModel.polite  || fallbackReplies.polite),
      firm:    str(repliesFromModel.firm    || fallbackReplies.firm)
    };

    // Payload kompatybilny z Twoim indexem (i “starymi” nazwami)
    const payload = {
      ok: true,

      detectedLang,
      detected: detectedLang,
      lang: detectedLang,

      sourceLang: effectiveSource,
      userLang,

      translation,
      translatedText: translation,
      translated: translation,

      summary,
      whatOfficeSays: summary,
      communication: summary,
      officeSummary: summary,

      risks,
      riskList: risks,
      riskChips: risks,

      replies,
      examples: replies,
      responseExamples: replies
    };

    return json(200, headers, payload);
  } catch (err) {
    return json(500, corsHeaders(), { ok: false, error: String(err?.message || err) });
  }
};

/* ---------------- helpers ---------------- */

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

function buildReplies(lang, tone) {
  const L = (lang || "PL").toUpperCase();

  const pl = {
    neutral:
`Dzień dobry,
dziękuję za wiadomość. Proszę o informację, czy pismo wymaga ode mnie działania oraz jakie są terminy.
Z poważaniem,`,
    polite:
`Dzień dobry,
uprzejmie proszę o potwierdzenie, czy wymagane są dalsze kroki z mojej strony oraz do kiedy.
Z wyrazami szacunku,`,
    firm:
`Dzień dobry,
proszę o jasne wskazanie wymaganych działań i terminów.
Z poważaniem,`
  };

  const en = {
    neutral:
`Hello,
thank you for your message. Please confirm whether any action is required from me and what the deadlines are.
Kind regards,`,
    polite:
`Hello,
could you please confirm whether any further steps are required from my side and by when?
Yours sincerely,`,
    firm:
`Hello,
please clearly indicate the required actions and deadlines.
Kind regards,`
  };

  const nl = {
    neutral:
`Goedemiddag,
dank voor uw bericht. Kunt u aangeven of ik actie moet ondernemen en wat de termijnen zijn?
Met vriendelijke groet,`,
    polite:
`Goedemiddag,
kunt u alstublieft bevestigen of er verdere stappen van mijn kant nodig zijn en vóór welke datum?
Met vriendelijke groet,`,
    firm:
`Goedemiddag,
graag ontvang ik een duidelijke opsomming van de vereiste acties en termijnen.
Met vriendelijke groet,`
  };

  const de = {
    neutral:
`Guten Tag,
vielen Dank für Ihre Nachricht. Bitte teilen Sie mir mit, ob ich etwas tun muss und welche Fristen gelten.
Mit freundlichen Grüßen,`,
    polite:
`Guten Tag,
könnten Sie bitte bestätigen, ob weitere Schritte von meiner Seite erforderlich sind und bis wann?
Mit freundlichen Grüßen,`,
    firm:
`Guten Tag,
bitte nennen Sie die erforderlichen Maßnahmen und Fristen eindeutig.
Mit freundlichen Grüßen,`
  };

  const map = { PL: pl, EN: en, NL: nl, DE: de };
  return map[L] || pl;
}

async function callOpenAIJson(apiKey, prompt) {
  const res = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${apiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model: "gpt-4o-mini",
      temperature: 0,
      max_output_tokens: 900,
      input: prompt,
      text: { format: { type: "text" } }
    })
  });

  const data = await res.json();
  if (!res.ok) throw new Error(`OpenAI error ${res.status}: ${JSON.stringify(data)}`);

  const raw = extractTextFromResponses(data);
  const jsonText = extractJson(raw);
  return JSON.parse(jsonText);
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
  temperature: 0,
  max_output_tokens: 900,
  input: prompt,
  text: { format: { type: "json_object" } }
})
  });

  const data = await res.json();
  if (!res.ok) throw new Error(`OpenAI error ${res.status}: ${JSON.stringify(data)}`);

  return extractTextFromResponses(data).trim();
}

function extractTextFromResponses(data) {
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

function extractJson(s) {
  const t = String(s || "").trim();
  if (t.startsWith("{") && t.endsWith("}")) return t;

  const start = t.indexOf("{");
  const end = t.lastIndexOf("}");
  if (start !== -1 && end !== -1 && end > start) return t.slice(start, end + 1);

  throw new Error("Nie udało się wyciągnąć JSON z odpowiedzi modelu.");
}