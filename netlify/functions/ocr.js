exports.handler = async (event) => {
  try {
    if (event.httpMethod !== "POST") {
      return json(405, { ok: false, error: "Method not allowed" });
    }

    const { imageDataUrl } = JSON.parse(event.body || "{}");

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

    const text =
      data.output_text ||
      data.output?.[0]?.content?.[0]?.text ||
      "";

    return json(200, {
      ok: true,
      text: String(text || "").trim()
    });
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
