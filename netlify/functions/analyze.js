// netlify/functions/analyze.js  (CommonJS)
// Sense Bridge — analiza pisma + spokojna analiza ryzyka oszustwa

exports.handler = async (event) => {
  const headers = corsHeaders();

  if (event.httpMethod === "OPTIONS") {    result.fraudRisk = fraudOverrideBySignals(inputText, result.fraudRisk, userLang);

    return { statusCode: 200, headers, body: "" };
  }

  try {
    const body = safeJson(event.body);
    const text = str(body.text || body.input || body.content || body.document || "");
    const sourceLang = str(body.sourceLang || body.source || "AUTO").toUpperCase();
    const userLang = str(body.userLang || body.targetLang || body.target || "PL").toUpperCase();
    const tone = str(body.tone || body.style || "neutral").toLowerCase();

    if (!text) {
      const fallbackReplies = buildReplies(userLang, tone);
      return json(200, headers, {
        ok: true,
        detectedLang: "UNKNOWN",
        detected: "UNKNOWN",
        lang: "UNKNOWN",
        sourceLang,
        userLang,
        translation: "",
        translatedText: "",
        translated: "",
        summary: emptyAnalysisText(userLang),
        whatOfficeSays: emptyAnalysisText(userLang),
        communication: emptyAnalysisText(userLang),
        officeSummary: emptyAnalysisText(userLang),
        risks: [],
        riskList: [],
        riskChips: [],
        fraudRisk: {
          level: "UNKNOWN",
          confidence: 0,
          label: emptyAnalysisText(userLang),
          summary: emptyFraudText(userLang),
          signals: [],
          suspiciousElements: [],
          safeSteps: [],
          disclaimer: "To jest analiza ryzyka, nie potwierdzenie autentyczności dokumentu."
        },
        replies: fallbackReplies,
        examples: fallbackReplies,
        responseExamples: fallbackReplies
      });
    }

    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      return json(500, headers, {
        ok: false,
        error: "Brak OPENAI_API_KEY w zmiennych środowiskowych Netlify."
      });
    }

    const analysisPrompt = `
Zadanie: przeanalizuj pismo urzędowe lub formalne. To NIE jest porada prawna.

DODATKOWE ZADANIE: oceń spokojnie ryzyko możliwego oszustwa / phishingu / podszywania się.
To ma być ANALIZA RYZYKA, nie wyrok. Nigdy nie pisz, że dokument jest na 100% prawdziwy albo na 100% fałszywy.

Twoim celem jest spokojne wyjaśnienie sytuacji użytkownikowi:
- co oznacza pismo
- czego urząd lub nadawca oczekuje
- co użytkownik powinien zrobić
- jakie mogą być konsekwencje
- czy potrzebna jest pomoc
- czy są sygnały typowe dla oszustw

Odpowiadaj w języku użytkownika: ${userLang}.

DOPRACOWANIE WIELOJĘZYCZNE SENSE BRIDGE:
Obsługiwane języki użytkownika: PL, UA, NL, EN, DE, FR, IT, ES, PT.
Wszystkie pola tekstowe JSON mają być w języku użytkownika ${userLang}, w tym:
summary, actions, consequences, risks, help, fraudRisk.label, fraudRisk.summary, fraudRisk.signals, fraudRisk.suspiciousElements, fraudRisk.safeSteps, fraudRisk.disclaimer oraz replies.
Nie mieszaj języków w jednej analizie. Nazwy instytucji i oficjalne adresy stron zostaw w oryginale.
Używaj prostego, ludzkiego języka. Dla zwykłych pism informacyjnych używaj spokojnego tonu.

PHISHING OVERRIDE RULE:
Jeżeli dokument zawiera presję czasu, groźbę blokady konta, nietypową domenę/link oraz prośbę o login, hasło, TAN, kod lub potwierdzenie tożsamości, ustaw fraudRisk.level = "HIGH".
Nie opisuj takiej wiadomości jako spokojnej ani normalnej, nawet jeśli podszywa się pod znaną instytucję.


Wykonaj:

1) wykryj język dokumentu (detectedLang)

2) napisz krótkie, spokojne streszczenie (bez straszenia)

3) wypisz konkretne działania użytkownika (jasne kroki).
Pierwsze 2-3 działania mają tworzyć praktyczny blok „Co zrobić teraz?”.
Nie dawaj ogólników, tylko proste kroki typu: sprawdź datę, zaloguj się ręcznie przez oficjalną stronę, przygotuj dokument, zadzwoń na numer z oficjalnej strony.

3a) oceń, czy odpowiedź jest wymagana:
- jeśli pismo jest tylko informacyjne → responseRequired = "NO"
- jeśli trzeba dosłać dokumenty / potwierdzić / zareagować → responseRequired = "YES"
- jeśli nie da się ocenić → responseRequired = "UNKNOWN"

3b) określ ton pisma: documentTone, np. informacyjny, formalny, ostrzegawczy, pilny, techniczny, neutralny.

4) określ pilność:
- LOW → informacyjne
- MEDIUM → warto zareagować
- HIGH → pilne działanie wymagane

5) wypisz możliwe konsekwencje (realne, bez przesady)

6) wypisz ryzyka komunikacyjne (konkretne, nie ogólne)

7) podaj 3 odpowiedzi:
- neutralna
- uprzejma
- stanowcza

8) sekcja "help":
Jeśli rozpoznasz kraj (np. NL, DE itd.):

dla NL użyj:
- Belastingdienst / Toeslagen (https://www.toeslagen.nl)
- Juridisch Loket (darmowa pomoc prawna)
- Gemeente (lokalna pomoc)

Dla innych krajów:
- użyj realnych instytucji państwowych jeśli jesteś pewien
- jeśli nie jesteś pewien → NIE zgaduj

Jeśli brak kraju:
- podaj bezpieczne opcje:
  - urząd nadawcy
  - darmowa pomoc prawna

9) oceń potrzebę pomocy prawnej:
- NONE → brak potrzeby
- RECOMMENDED → warto skonsultować
- URGENT → pilnie skonsultuj

10) Oceń ryzyko oszustwa w obiekcie fraudRisk:

11) Rozpoznaj możliwą instytucję, kraj i oficjalną stronę.

Jeśli rozpoznajesz urząd, bank lub instytucję:
- zwróć institution.name
- zwróć institution.country
- zwróć institution.officialWebsite
- zwróć institution.confidence (0-100)

Rozpoznawaj m.in.:
- DigiD
- UWV
- Belastingdienst
- Toeslagen
- Gemeente
- IND
- SVB
- DUO
- CJIB
- RDW
- ING
- Rabobank
- ABN AMRO
- ASN Bank
- European housing departments
- tax offices
- immigration offices
- official municipalities

Jeśli nie jesteś pewien:
- NIE zgaduj
- ustaw confidence niżej
- officialWebsite może być pusty

12) Wykryj linki i numery telefonu z tekstu.

Zwróć:
- detectedLinks
- suspiciousLinks
- detectedPhones

Link uznaj za podejrzany jeśli:
- podszywa się pod urząd
- wygląda nietypowo
- ma dziwną domenę
- używa presji czasu
- wygląda jak phishing

fraudRisk.level:
- LOW → wygląda raczej wiarygodnie, brak mocnych sygnałów oszustwa
- MEDIUM → są nietypowe elementy, warto zweryfikować oficjalnym kanałem
- HIGH → wiele sygnałów typowych dla oszustwa/phishingu
- UNKNOWN → za mało danych, nie da się ocenić

fraudRisk.confidence:
liczba 0-100 określająca pewność analizy ryzyka, ale bez udawania 100% pewności.

fraudRisk.signals:
krótkie sygnały, np. presja czasu, nietypowy link, dziwny adres e-mail, prośba o login, IBAN, płatność, groźby.

fraudRisk.suspiciousElements:
konkretne elementy z tekstu, które warto sprawdzić. Jeśli nie ma takich elementów, zwróć pustą tablicę.

fraudRisk.safeSteps:
spokojne bezpieczne kroki, np. nie klikaj linku, nie podawaj danych, sprawdź przez oficjalną stronę, zadzwoń na numer z oficjalnej strony, zaloguj się ręcznie przez oficjalną domenę.

ZASADY OGÓLNE:
- NIE strasz użytkownika bez powodu
- NIE używaj czerwonego tonu jeśli sytuacja jest neutralna
- NIE zakładaj najgorszego scenariusza
- przy zwykłych pismach ze szpitala, szkoły, gminy lub portalu pacjenta unikaj słów „oszustwo” w sekcji risks, jeśli nie ma mocnych sygnałów fałszu
- zamiast „Możliwość oszustwa...” pisz łagodniej: „Warto potwierdzić autentyczność nadawcy przez oficjalną stronę”
- jeśli pismo wygląda normalnie i rozpoznano instytucję z oficjalną stroną, fraudRisk.level ustaw LOW albo spokojne MEDIUM, nigdy HIGH bez mocnych sygnałów
- używaj prostego, ludzkiego języka
- przy oszustwach pisz spokojnie: "warto zweryfikować", "nie da się potwierdzić autentyczności tylko z tekstu", "sprawdź oficjalnym kanałem"
- jeśli dokument wygląda normalnie, nie wymyślaj podejrzeń
- jeśli są linki, IBAN, numery telefonu, adresy e-mail lub presja czasu — oceń je jako osobne sygnały

REGUŁY PILNOŚCI (nadpisują wszystko):

Jeśli pismo dotyczy wizyty medycznej, rejestracji, portalu pacjenta, terminu, przygotowania do wizyty lub zwykłej informacji organizacyjnej:
→ urgency ustaw LOW albo MEDIUM
→ legalHelpNeeded ustaw NONE
→ consequences mają być praktyczne i spokojne, np. „wizyta może zostać przełożona”, a nie prawne lub alarmujące.
→ fraudRisk nie powinien sugerować oszustwa bez wyraźnych sygnałów.

Jeśli pismo jest informacyjne i nie prosi o odpowiedź, ustaw responseRequired = "NO".
Jeśli trzeba wykonać czynność, ale nie odpisać, wyjaśnij to w actions.

REGUŁY PILNOŚCI (nadpisują wszystko):

Jeśli występuje TYLKO prośba o dosłanie dokumentów, uzupełnienie danych, potwierdzenie informacji albo zwykły termin 7–14 dni:
→ ustaw:
"urgency": "MEDIUM"
"legalHelpNeeded": "NONE" albo "RECOMMENDED"
NIE ustawiaj URGENT.

URGENT ustaw TYLKO gdy występuje:
- sąd
- komornik
- egzekucja
- eksmisja
- wypowiedzenie umowy
- deportacja
- kara finansowa
- windykacja długu
- zajęcie konta lub wynagrodzenia
- groźba postępowania prawnego

Jeśli pismo dotyczy dodatku, zasiłku, huurtoeslag lub dokumentów:
- zwykle ustaw MEDIUM
- legalHelpNeeded ustaw RECOMMENDED tylko jeśli są duże konsekwencje
- nie pisz „pilnie skonsultuj z prawnikiem”, jeśli chodzi tylko o dosłanie dokumentów.

W przypadku URGENT:
pierwszy punkt help MUSI zawierać:
"Pilnie skonsultuj sprawę z prawnikiem lub darmową pomocą prawną"

Zwróć WYŁĄCZNIE JSON (json_object):

{
  "detectedLang": "NL",
  "summary": "...",
  "documentTone": "informacyjny",
  "responseRequired": "NO",
  "nextSteps": ["...", "...", "..."],
  "actions": ["...", "..."],
  "urgency": "LOW",
  "consequences": ["...", "..."],
  "risks": ["...", "..."],
  "help": ["...", "..."],
  "helpLinks": [
    {
      "label": "Belastingdienst / Toeslagen",
      "url": "https://www.toeslagen.nl",
      "type": "institution"
    }
  ],
  "legalHelpNeeded": "RECOMMENDED",
  "fraudRisk": {
    "level": "MEDIUM",
    "confidence": 72,
    "label": "Warto zweryfikować nadawcę",
    "summary": "...",
    "signals": ["...", "..."],
    "suspiciousElements": ["...", "..."],
    "safeSteps": ["...", "..."],
    "disclaimer": "To jest analiza ryzyka, nie potwierdzenie autentyczności dokumentu."
  },
  
  "institution": {
  "name": "DigiD",
  "country": "NL",
  "officialWebsite": "https://www.digid.nl",
  "confidence": 92
},

"detectedLinks": ["https://example.com"],
"suspiciousLinks": ["http://fake-example-login.com"],
"detectedPhones": ["+31 6 12345678"],

  "replies": {
    "neutral": "...",
    "polite": "...",
    "firm": "..."
  }
}

TEKST:
${text}
`.trim();

    const modelJson = await callOpenAIJsonObject(apiKey, analysisPrompt);

    const detectedLang = str(modelJson.detectedLang || "UNKNOWN").toUpperCase();
    const summary = cleanAiText(str(modelJson.summary || ""));
    const documentTone = cleanAiText(str(modelJson.documentTone || ""));
    const responseRequiredRaw = str(modelJson.responseRequired || "UNKNOWN").toUpperCase();
    const responseRequired = ["YES", "NO", "UNKNOWN"].includes(responseRequiredRaw) ? responseRequiredRaw : "UNKNOWN";
    const nextSteps = arr(modelJson.nextSteps).map(cleanAiText);
    let risks = arr(modelJson.risks).map(cleanAiText);
    let actions = arr(modelJson.actions).map(cleanAiText);
    let consequences = arr(modelJson.consequences).map(cleanAiText);
    let help = arr(modelJson.help).map(cleanAiText);

    const helpLinks = Array.isArray(modelJson.helpLinks)
      ? modelJson.helpLinks
          .filter(x => x && typeof x === "object" && x.label && x.url)
          .map(x => ({
            label: cleanAiText(String(x.label || "").trim()),
            url: String(x.url || "").trim(),
            type: cleanAiText(String(x.type || "info").trim())
          }))
      : [];

    const legalHelpNeeded = str(modelJson.legalHelpNeeded || "UNKNOWN").toUpperCase();
    let legalHelpFinal = ["NONE", "RECOMMENDED", "URGENT"].includes(legalHelpNeeded)
      ? legalHelpNeeded
      : "RECOMMENDED";

    let urgency = str(modelJson.urgency || "UNKNOWN").toUpperCase();
    const repliesFromModel = (modelJson.replies && typeof modelJson.replies === "object") ? modelJson.replies : {};

    const fraudRisk = normalizeFraudRisk(modelJson.fraudRisk, userLang);
    
    const institution =
  normalizeInstitution(modelJson.institution);
const detectedLinks = arr(modelJson.detectedLinks);
const suspiciousLinks = arr(modelJson.suspiciousLinks);
const detectedPhones = arr(modelJson.detectedPhones);
const suspiciousDomains = [
  "digid-login.com",
  "uwv-controle.net",
  "belasting-check.info",
  "verify-digid.com",
  "secure-toeslagen.net"
];

const suspiciousPhones = [
  "+3197004499999",
  "+31880000000"
];

const matchedSuspiciousLinks = detectedLinks.filter(link =>
  suspiciousDomains.some(domain =>
    link.toLowerCase().includes(domain)
  )
);

const suspiciousPhoneMatches = detectedPhones.filter(phone =>
  suspiciousPhones.includes(phone)
);
if (
  matchedSuspiciousLinks.length > 0 ||
  suspiciousPhoneMatches.length > 0
) {
  fraudRisk.level = "HIGH";

  if (!fraudRisk.label) {
    fraudRisk.label =
      "Wykryto znane sygnały phishingu";
  }

  fraudRisk.confidence =
    Math.max(fraudRisk.confidence || 0, 85);

  fraudRisk.signals = [
    ...(fraudRisk.signals || []),
    "Wykryto podejrzaną domenę lub numer telefonu"
  ];
}

applyKnownInstitutionFix(institution, text);
postProcessNormalDocument({
  fraudRisk,
  institution,
  detectedLinks,
  matchedSuspiciousLinks,
  suspiciousPhoneMatches,
  userLang,
  text
});

const contextFix = classifyDocumentContext(text);
if (contextFix.medicalAppointment) {
  legalHelpFinal = "NONE";
  if (!urgency || urgency === "UNKNOWN" || urgency === "HIGH") urgency = "MEDIUM";
  risks = softenRisksForNormalDocument(risks, userLang);
  consequences = softenConsequencesForAppointment(consequences, userLang);
}

    const effectiveSource = (sourceLang === "AUTO" ? detectedLang : sourceLang) || "UNKNOWN";

    let translation = "";
    if (!effectiveSource || effectiveSource === "UNKNOWN" || effectiveSource === userLang || userLang === "AUTO") {
      translation = text;
    } else {
      const translatePrompt = `
Przetłumacz poniższy tekst na język: ${userLang}.
Zachowaj sens, ton i format (akapity, listy).
Zwróć WYŁĄCZNIE przetłumaczony tekst, bez komentarzy.

TEKST:
${text}
`.trim();

      translation = cleanAiText(await callOpenAIText(apiKey, translatePrompt));
    }

    const fallbackReplies = buildReplies(userLang, tone);

    const replies = {
      neutral: cleanAiText(str(repliesFromModel.neutral || fallbackReplies.neutral)),
      polite: cleanAiText(str(repliesFromModel.polite || fallbackReplies.polite)),
      firm: cleanAiText(str(repliesFromModel.firm || fallbackReplies.firm))
    };

    translation = cleanAiText(translation);

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
      documentTone,
      responseRequired,
      nextSteps: nextSteps.length ? nextSteps : actions.slice(0, 3),
      whatOfficeSays: summary,
      communication: summary,
      officeSummary: summary,
      actions,
      urgency,
      consequences,
      help,
      helpLinks,
      legalHelpNeeded: legalHelpFinal,
      fraudRisk,
      scamRisk: fraudRisk,
      authenticityRisk: fraudRisk,
      institution,
detectedLinks,
suspiciousLinks: [...suspiciousLinks, ...matchedSuspiciousLinks],
suspiciousPhoneMatches,
detectedPhones,
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

function arr(v) {
  return Array.isArray(v) ? v.filter(Boolean).map(x => String(x).trim()).filter(Boolean) : [];
}


function emptyAnalysisText(lang) {
  const L = (lang || "PL").toUpperCase();
  const map = {
    PL: "Brak tekstu do analizy.",
    EN: "No text to analyze.",
    NL: "Geen tekst om te analyseren.",
    DE: "Kein Text zur Analyse.",
    UA: "Немає тексту для аналізу.",
    FR: "Aucun texte à analyser.",
    IT: "Nessun testo da analizzare.",
    ES: "No hay texto para analizar.",
    PT: "Não há texto para analisar."
  };
  return map[L] || map.PL;
}

function emptyFraudText(lang) {
  const L = (lang || "PL").toUpperCase();
  const map = {
    PL: "Brak tekstu do analizy ryzyka oszustwa.",
    EN: "No text for fraud risk analysis.",
    NL: "Geen tekst voor fraude-risicoanalyse.",
    DE: "Kein Text für die Betrugsrisikoanalyse.",
    UA: "Немає тексту для аналізу ризику шахрайства.",
    FR: "Aucun texte pour l’analyse du risque de fraude.",
    IT: "Nessun testo per l’analisi del rischio di frode.",
    ES: "No hay texto para el análisis de riesgo de fraude.",
    PT: "Não há texto para a análise de risco de fraude."
  };
  return map[L] || map.PL;
}

function cleanAiText(value) {
  return String(value || "")
    .replace(/```(?:json|text)?/gi, "")
    .replace(/```/g, "")
    .replace(/^[\s\"'“”„`]+/, "")
    .replace(/[\s\"'“”„`]+$/, "")
    .replace(/"""/g, "")
    .replace(/'''/g, "")
    .trim();
}

function classifyDocumentContext(text) {
  const t = String(text || "").toLowerCase();
  return {
    medicalAppointment: /afspraak|appointment|wizyta|ziekenhuis|hospital|patient|pati[eë]nt|mijnetz|etz|elisabeth|tweesteden|aanmeldzuil/.test(t),
    payment: /iban|betaling|betaal|payment|overmaken|kwota|amount|bankrekening/.test(t),
    legalThreat: /rechtbank|court|komornik|deurwaarder|egzekuc|eviction|uitzetting|deport|boete|fine|incasso|debt|schuld|beslag/.test(t),
    strongPressure: /vandaag|direct|immediately|urgent|laatste kans|last chance|binnen 24 uur|within 24 hours/.test(t)
  };
}

function applyKnownInstitutionFix(institution, text) {
  if (!institution) return;
  const t = String(text || "").toLowerCase();

  if (/elisabeth|tweesteden|etz|mijnetz/.test(t)) {
    institution.name = institution.name || "Elisabeth-TweeSteden Ziekenhuis";
    institution.country = institution.country || "NL";
    institution.officialWebsite = institution.officialWebsite || "https://www.etz.nl";
    institution.confidence = Math.max(Number(institution.confidence || 0), 85);
  }

  if (/belastingdienst/.test(t)) {
    institution.name = institution.name || "Belastingdienst";
    institution.country = institution.country || "NL";
    institution.officialWebsite = institution.officialWebsite || "https://www.belastingdienst.nl";
    institution.confidence = Math.max(Number(institution.confidence || 0), 85);
  }
}

function postProcessNormalDocument(ctx) {
  const { fraudRisk, institution, detectedLinks, matchedSuspiciousLinks, suspiciousPhoneMatches, userLang, text } = ctx;
  if (!fraudRisk) return;

  const doc = classifyDocumentContext(text);
  const knownInstitution = institution && institution.officialWebsite && Number(institution.confidence || 0) >= 75;
  const hasKnownBad = (matchedSuspiciousLinks || []).length > 0 || (suspiciousPhoneMatches || []).length > 0;
  const hasHardRisk = hasKnownBad || doc.payment || doc.legalThreat || doc.strongPressure;

  if (knownInstitution && !hasHardRisk) {
    fraudRisk.level = "LOW";
    fraudRisk.confidence = Math.max(60, Math.min(Number(fraudRisk.confidence || 70), 78));
    fraudRisk.label = calmFraudLabel(userLang, "LOW");
    fraudRisk.summary = calmFraudSummary(userLang, institution.name);
    fraudRisk.suspiciousElements = [];
    fraudRisk.signals = filterAlarmSignals(fraudRisk.signals);
    fraudRisk.safeSteps = calmSafeSteps(userLang, institution.officialWebsite);
  } else if (knownInstitution && fraudRisk.level === "HIGH" && !hasKnownBad) {
    fraudRisk.level = "MEDIUM";
    fraudRisk.confidence = Math.min(Number(fraudRisk.confidence || 70), 75);
    fraudRisk.label = calmFraudLabel(userLang, "MEDIUM");
  }
}

function filterAlarmSignals(list) {
  return arr(list).filter(x => !/oszust|fraud|phishing|scam/i.test(x));
}

function calmFraudLabel(lang, level) {
  const L = (lang || "PL").toUpperCase();
  const map = {
    PL: { LOW: "Wygląda spokojnie, warto tylko sprawdzić źródło", MEDIUM: "Warto zweryfikować nadawcę" },
    EN: { LOW: "Looks calm, just verify the source", MEDIUM: "Verify the sender" },
    NL: { LOW: "Lijkt rustig, controleer alleen de bron", MEDIUM: "Controleer de afzender" },
    DE: { LOW: "Wirkt unauffällig, Quelle kurz prüfen", MEDIUM: "Absender prüfen" },
    UA: { LOW: "Виглядає спокійно, лише перевірте джерело", MEDIUM: "Варто перевірити відправника" }
  };
  return (map[L] || map.PL)[level] || (map[L] || map.PL).MEDIUM;
}

function calmFraudSummary(lang, institutionName) {
  const name = institutionName || "the institution";
  const L = (lang || "PL").toUpperCase();
  if (L === "NL") return `Het bericht lijkt normaal voor ${name}. Controleer bij twijfel via de officiële website.`;
  if (L === "EN") return `The letter looks normal for ${name}. If unsure, verify it through the official website.`;
  if (L === "DE") return `Das Schreiben wirkt für ${name} normal. Bei Zweifel über die offizielle Website prüfen.`;
  if (L === "UA") return `Лист виглядає типовим для ${name}. Якщо є сумніви, перевірте через офіційний сайт.`;
  return `Pismo wygląda normalnie dla instytucji ${name}. Jeśli masz wątpliwości, zweryfikuj je przez oficjalną stronę.`;
}

function calmSafeSteps(lang, website) {
  const L = (lang || "PL").toUpperCase();
  if (L === "NL") return ["Open de officiële website handmatig.", "Log alleen in via het officiële portaal.", "Bel bij twijfel het nummer van de officiële website."];
  if (L === "EN") return ["Open the official website manually.", "Log in only through the official portal.", "If unsure, call the number from the official website."];
  if (L === "DE") return ["Öffnen Sie die offizielle Website manuell.", "Melden Sie sich nur über das offizielle Portal an.", "Bei Zweifel die Nummer von der offiziellen Website anrufen."];
  if (L === "UA") return ["Відкрийте офіційний сайт вручну.", "Заходьте лише через офіційний портал.", "Якщо сумніваєтесь, телефонуйте за номером з офіційного сайту."];
  return ["Otwórz oficjalną stronę ręcznie.", "Loguj się tylko przez oficjalny portal.", "W razie wątpliwości zadzwoń na numer z oficjalnej strony."];
}

function softenRisksForNormalDocument(risks, lang) {
  const L = (lang || "PL").toUpperCase();
  const cleaned = arr(risks).filter(r => !/oszust|phishing|scam|fałsz|fraud/i.test(r));
  if (cleaned.length) return cleaned;
  if (L === "NL") return ["Controleer de afspraakgegevens via het officiële portaal.", "Onvoldoende voorbereiding kan de afspraak vertragen of verplaatsen."];
  if (L === "EN") return ["Check the appointment details through the official portal.", "If you are not prepared, the appointment may be delayed or rescheduled."];
  if (L === "DE") return ["Prüfen Sie die Termindaten über das offizielle Portal.", "Bei fehlender Vorbereitung kann der Termin verschoben werden."];
  if (L === "UA") return ["Перевірте деталі візиту через офіційний портал.", "Якщо ви не підготовані, візит можуть перенести."];
  return ["Sprawdź szczegóły wizyty przez oficjalny portal.", "Brak przygotowania może opóźnić lub przesunąć wizytę."];
}

function softenConsequencesForAppointment(consequences, lang) {
  const L = (lang || "PL").toUpperCase();
  const base = arr(consequences).filter(c => !/praw|legal|kara|boete|fine|oszust|scam/i.test(c));
  if (base.length) return base;
  if (L === "NL") return ["De afspraak kan niet doorgaan als u niet voorbereid bent.", "U moet mogelijk opnieuw een afspraak maken."];
  if (L === "EN") return ["The appointment may not go ahead if you are not prepared.", "You may need to make a new appointment."];
  if (L === "DE") return ["Der Termin kann ausfallen, wenn Sie nicht vorbereitet sind.", "Möglicherweise müssen Sie einen neuen Termin vereinbaren."];
  if (L === "UA") return ["Візит може не відбутися, якщо ви не підготовані.", "Можливо, доведеться записатися знову."];
  return ["Wizyta może się nie odbyć, jeśli nie będziesz przygotowany.", "Może być potrzebne umówienie nowego terminu."];
}

function normalizeFraudRisk(v, userLang) {
  const obj = (v && typeof v === "object") ? v : {};
  let level = String(obj.level || "UNKNOWN").trim().toUpperCase();
  if (!["LOW", "MEDIUM", "HIGH", "UNKNOWN"].includes(level)) level = "UNKNOWN";

  let confidence = Number(obj.confidence || 0);
  if (!Number.isFinite(confidence)) confidence = 0;
  confidence = Math.max(0, Math.min(100, Math.round(confidence)));

  const fallback = fraudFallback(userLang, level);

  return {
    level,
    confidence,
    label: cleanAiText(str(obj.label) || fallback.label),
    summary: cleanAiText(str(obj.summary) || fallback.summary),
    signals: arr(obj.signals).map(cleanAiText),
    suspiciousElements: arr(obj.suspiciousElements).map(cleanAiText),
    safeSteps: arr(obj.safeSteps).length ? arr(obj.safeSteps).map(cleanAiText) : fallback.safeSteps,
    disclaimer: cleanAiText(str(obj.disclaimer) || fallback.disclaimer)
  };
}

function normalizeInstitution(v) {
  const obj = (v && typeof v === "object") ? v : {};

  return {
    name: str(obj.name || ""),
    country: str(obj.country || "").toUpperCase(),
    officialWebsite: str(obj.officialWebsite || ""),
    confidence: Math.max(
      0,
      Math.min(100, Number(obj.confidence || 0))
    )
  };
}


function detectHardFraudSignals(rawText) {
  const t = String(rawText || "").toLowerCase();

  const suspiciousDomain =
    /(security|verify|verifizierung|verification|konto|account|login|secure|check)[a-z0-9\-]*\.(com|net|info|top|xyz|click|site|online)/i.test(t) ||
    /https?:\/\/(?![^\/]*(sparkasse\.de|belastingdienst\.nl|digid\.nl|uwv\.nl|etz\.nl|ind\.nl|svb\.nl|duo\.nl|paypal\.com|amazon\.[a-z.]+|rabobank\.nl|ing\.nl|abnamro\.nl))[^\/\s]+/i.test(t);

  const timePressure =
    /(24\s*(uur|u|hours|stunden|std|godzin|h)|binnen\s*24|within\s*24|innerhalb\s*24|pilnie|urgent|urgently|dringend|sofort|natychmiast|immediately)/i.test(t);

  const accountThreat =
    /(konto|account|rekening|bankkonto).{0,80}(sperr|blocked|block|deaktiv|deactiv|zamkni|zablok|suspended|suspend|gesperrt)/i.test(t) ||
    /(sperrung|blokada|deactivation|deaktivierung|suspension)/i.test(t);

  const credentialRequest =
    /(tan|2fa|code|password|passwort|hasło|login|zugangsdaten|bankgegevens|gegevens|identity|identiteit|tożsamość|verify your identity|bestätigen sie.*identität)/i.test(t);

  const financialBrand =
    /(sparkasse|bank|paypal|ing|rabobank|abn|creditcard|visa|mastercard|konto|rekening|bankkonto)/i.test(t);

  const suspiciousScore =
    [suspiciousDomain, timePressure, accountThreat, credentialRequest, financialBrand].filter(Boolean).length;

  return {
    suspiciousDomain,
    timePressure,
    accountThreat,
    credentialRequest,
    financialBrand,
    suspiciousScore,
    hardHigh: suspiciousScore >= 3 && (suspiciousDomain || credentialRequest),
    hardMedium: suspiciousScore >= 2
  };
}

function fraudOverrideBySignals(rawText, fraudRisk, lang) {
  const L = (lang || "PL").toUpperCase();
  const s = detectHardFraudSignals(rawText);

  const labels = {
    PL: {
      high: "Wysokie ryzyko oszustwa",
      medium: "Podejrzana wiadomość — sprawdź źródło",
      summaryHigh: "Wiadomość zawiera silne sygnały phishingu: presję czasu, nietypowy link lub prośbę o dane logowania.",
      summaryMedium: "Wiadomość zawiera elementy wymagające ostrożności. Zweryfikuj ją wyłącznie przez oficjalne kanały."
    },
    EN: {
      high: "High fraud risk",
      medium: "Suspicious message — verify the source",
      summaryHigh: "The message contains strong phishing signals: time pressure, an unusual link or a request for login details.",
      summaryMedium: "The message contains elements that require caution. Verify it only through official channels."
    },
    NL: {
      high: "Hoog risico op fraude",
      medium: "Verdacht bericht — controleer de bron",
      summaryHigh: "Het bericht bevat sterke phishing-signalen: tijdsdruk, een ongebruikelijke link of een verzoek om inloggegevens.",
      summaryMedium: "Het bericht bevat elementen die om voorzichtigheid vragen. Controleer dit alleen via officiële kanalen."
    },
    DE: {
      high: "Hohes Betrugsrisiko",
      medium: "Verdächtige Nachricht — Quelle prüfen",
      summaryHigh: "Die Nachricht enthält starke Phishing-Signale: Zeitdruck, einen ungewöhnlichen Link oder die Aufforderung zu Zugangsdaten.",
      summaryMedium: "Die Nachricht enthält Elemente, die Vorsicht erfordern. Prüfen Sie sie nur über offizielle Kanäle."
    },
    UA: {
      high: "Високий ризик шахрайства",
      medium: "Підозріле повідомлення — перевірте джерело",
      summaryHigh: "Повідомлення містить сильні ознаки фішингу: тиск часу, незвичне посилання або запит даних для входу.",
      summaryMedium: "Повідомлення містить елементи, що потребують обережності. Перевіряйте лише через офіційні канали."
    },
    FR: {
      high: "Risque élevé de fraude",
      medium: "Message suspect — vérifiez la source",
      summaryHigh: "Le message contient de forts signaux de phishing : pression temporelle, lien inhabituel ou demande d’identifiants.",
      summaryMedium: "Le message contient des éléments qui demandent de la prudence. Vérifiez uniquement via les canaux officiels."
    },
    IT: {
      high: "Alto rischio di frode",
      medium: "Messaggio sospetto — verifica la fonte",
      summaryHigh: "Il messaggio contiene forti segnali di phishing: pressione temporale, link insolito o richiesta di dati di accesso.",
      summaryMedium: "Il messaggio contiene elementi che richiedono cautela. Verifica solo tramite canali ufficiali."
    },
    ES: {
      high: "Alto riesgo de fraude",
      medium: "Mensaje sospechoso — verifica la fuente",
      summaryHigh: "El mensaje contiene señales fuertes de phishing: presión de tiempo, enlace inusual o solicitud de datos de acceso.",
      summaryMedium: "El mensaje contiene elementos que requieren cautela. Verifícalo solo por canales oficiales."
    },
    PT: {
      high: "Alto risco de fraude",
      medium: "Mensagem suspeita — verifique a fonte",
      summaryHigh: "A mensagem contém fortes sinais de phishing: pressão de tempo, link incomum ou pedido de dados de acesso.",
      summaryMedium: "A mensagem contém elementos que exigem cautela. Verifique apenas por canais oficiais."
    }
  };

  const tr = labels[L] || labels.PL;
  const fr = fraudRisk || {};

  if (s.hardHigh) {
    fr.level = "HIGH";
    fr.label = tr.high;
    fr.summary = tr.summaryHigh;
    fr.confidence = Math.max(Number(fr.confidence || 0), 90);
  } else if (s.hardMedium && String(fr.level || "").toUpperCase() !== "HIGH") {
    fr.level = "MEDIUM";
    fr.label = tr.medium;
    fr.summary = tr.summaryMedium;
    fr.confidence = Math.max(Number(fr.confidence || 0), 75);
  }

  const extraSignals = [];
  if (s.timePressure) extraSignals.push({
    PL:"Presja czasu lub groźba szybkiej blokady.", EN:"Time pressure or threat of quick blocking.", NL:"Tijdsdruk of dreiging van snelle blokkade.", DE:"Zeitdruck oder Drohung einer schnellen Sperrung.", UA:"Тиск часу або погроза швидкого блокування.", FR:"Pression temporelle ou menace de blocage rapide.", IT:"Pressione temporale o minaccia di blocco rapido.", ES:"Presión de tiempo o amenaza de bloqueo rápido.", PT:"Pressão de tempo ou ameaça de bloqueio rápido."
  }[L] || "Presja czasu lub groźba szybkiej blokady.");
  if (s.credentialRequest) extraSignals.push({
    PL:"Prośba o dane logowania, TAN, kod lub potwierdzenie tożsamości.", EN:"Request for login details, TAN, code or identity confirmation.", NL:"Verzoek om inloggegevens, TAN, code of identiteitsbevestiging.", DE:"Aufforderung zu Zugangsdaten, TAN, Code oder Identitätsbestätigung.", UA:"Запит даних для входу, TAN, коду або підтвердження особи.", FR:"Demande d’identifiants, de code TAN ou de confirmation d’identité.", IT:"Richiesta di credenziali, TAN, codice o conferma dell’identità.", ES:"Solicitud de datos de acceso, TAN, código o confirmación de identidad.", PT:"Pedido de dados de acesso, TAN, código ou confirmação de identidade."
  }[L] || "Prośba o dane logowania, TAN, kod lub potwierdzenie tożsamości.");
  if (s.suspiciousDomain) extraSignals.push({
    PL:"Nietypowa domena lub link spoza oficjalnej strony.", EN:"Unusual domain or link outside the official website.", NL:"Ongebruikelijk domein of link buiten de officiële website.", DE:"Ungewöhnliche Domain oder Link außerhalb der offiziellen Website.", UA:"Незвичний домен або посилання поза офіційним сайтом.", FR:"Domaine inhabituel ou lien hors du site officiel.", IT:"Dominio insolito o link fuori dal sito ufficiale.", ES:"Dominio inusual o enlace fuera del sitio oficial.", PT:"Domínio incomum ou link fora do site oficial."
  }[L] || "Nietypowa domena lub link spoza oficjalnej strony.");

  fr.signals = Array.from(new Set([...(Array.isArray(fr.signals) ? fr.signals : []), ...extraSignals])).slice(0, 6);

  const safe = {
    PL:["Nie klikaj linku z wiadomości.", "Otwórz oficjalną stronę ręcznie.", "Nie podawaj loginu, hasła, TAN ani danych bankowych.", "Skontaktuj się z instytucją przez oficjalny numer."],
    EN:["Do not click the link in the message.", "Open the official website manually.", "Do not share login, password, TAN or banking details.", "Contact the institution using the official phone number."],
    NL:["Klik niet op de link in het bericht.", "Open de officiële website handmatig.", "Deel geen login, wachtwoord, TAN of bankgegevens.", "Neem contact op via het officiële telefoonnummer."],
    DE:["Klicken Sie nicht auf den Link in der Nachricht.", "Öffnen Sie die offizielle Website manuell.", "Geben Sie keine Zugangsdaten, Passwörter, TANs oder Bankdaten ein.", "Kontaktieren Sie die Institution über die offizielle Telefonnummer."],
    UA:["Не натискайте посилання в повідомленні.", "Відкрийте офіційний сайт вручну.", "Не вводьте логін, пароль, TAN або банківські дані.", "Зв’яжіться з установою через офіційний номер."],
    FR:["Ne cliquez pas sur le lien du message.", "Ouvrez le site officiel manuellement.", "Ne partagez pas vos identifiants, mot de passe, TAN ou données bancaires.", "Contactez l’institution via le numéro officiel."],
    IT:["Non cliccare sul link nel messaggio.", "Apri manualmente il sito ufficiale.", "Non condividere login, password, TAN o dati bancari.", "Contatta l’istituzione tramite il numero ufficiale."],
    ES:["No hagas clic en el enlace del mensaje.", "Abre el sitio oficial manualmente.", "No compartas usuario, contraseña, TAN ni datos bancarios.", "Contacta con la institución por el número oficial."],
    PT:["Não clique no link da mensagem.", "Abra o site oficial manualmente.", "Não partilhe login, palavra-passe, TAN ou dados bancários.", "Contacte a instituição através do número oficial."]
  }[L] || [];

  if (s.hardHigh || s.hardMedium) {
    fr.safeSteps = Array.from(new Set([...safe, ...(Array.isArray(fr.safeSteps) ? fr.safeSteps : [])])).slice(0, 6);
  }

  return fr;
}

function fraudFallback(lang, level) {
  const L = (lang || "PL").toUpperCase();

  const map = {
    PL: {
      LOW: "Wygląda raczej wiarygodnie",
      MEDIUM: "Warto zweryfikować nadawcę",
      HIGH: "Wysokie ryzyko oszustwa",
      UNKNOWN: "Nie da się ocenić autentyczności",
      summary: "To jest spokojna analiza ryzyka. Nie potwierdza autentyczności dokumentu.",
      safeSteps: ["Nie klikaj podejrzanych linków.", "Nie podawaj loginu, hasła ani danych bankowych.", "Zweryfikuj sprawę przez oficjalną stronę lub numer telefonu instytucji."],
      disclaimer: "To jest analiza ryzyka, nie potwierdzenie autentyczności dokumentu."
    },
    EN: {
      LOW: "Looks rather credible",
      MEDIUM: "Verify the sender",
      HIGH: "High fraud risk",
      UNKNOWN: "Authenticity cannot be assessed",
      summary: "This is a calm risk analysis. It does not confirm document authenticity.",
      safeSteps: ["Do not click suspicious links.", "Do not share login, password or banking details.", "Verify through the official website or phone number of the institution."],
      disclaimer: "This is a risk analysis, not confirmation of document authenticity."
    },
    NL: {
      LOW: "Lijkt redelijk betrouwbaar",
      MEDIUM: "Controleer de afzender",
      HIGH: "Hoog risico op fraude",
      UNKNOWN: "Echtheid kan niet worden beoordeeld",
      summary: "Dit is een rustige risicoanalyse. Het bevestigt niet of het document echt is.",
      safeSteps: ["Klik niet op verdachte links.", "Deel geen login, wachtwoord of bankgegevens.", "Controleer via de officiële website of het officiële telefoonnummer van de instantie."],
      disclaimer: "Dit is een risicoanalyse, geen bevestiging van de echtheid van het document."
    },
    DE: {
      LOW: "Wirkt eher glaubwürdig",
      MEDIUM: "Absender prüfen",
      HIGH: "Hohes Betrugsrisiko",
      UNKNOWN: "Echtheit kann nicht beurteilt werden",
      summary: "Dies ist eine ruhige Risikoanalyse. Sie bestätigt nicht die Echtheit des Dokuments.",
      safeSteps: ["Klicke nicht auf verdächtige Links.", "Gib keine Login-, Passwort- oder Bankdaten weiter.", "Prüfe die Situation über die offizielle Website oder Telefonnummer der Institution."],
      disclaimer: "Dies ist eine Risikoanalyse, keine Bestätigung der Echtheit des Dokuments."
    },
    UA: {
      LOW: "Виглядає досить достовірно",
      MEDIUM: "Варто перевірити відправника",
      HIGH: "Високий ризик шахрайства",
      UNKNOWN: "Неможливо оцінити автентичність",
      summary: "Це спокійний аналіз ризику. Він не підтверджує автентичність документа.",
      safeSteps: ["Не натискайте підозрілі посилання.", "Не передавайте логін, пароль або банківські дані.", "Перевірте ситуацію через офіційний сайт або офіційний номер телефону установи."],
      disclaimer: "Це аналіз ризику, а не підтвердження автентичності документа."
    },
    FR: {
      LOW: "Semble plutôt crédible",
      MEDIUM: "Vérifiez l’expéditeur",
      HIGH: "Risque élevé de fraude",
      UNKNOWN: "L’authenticité ne peut pas être évaluée",
      summary: "Il s’agit d’une analyse calme du risque. Elle ne confirme pas l’authenticité du document.",
      safeSteps: ["Ne cliquez pas sur les liens suspects.", "Ne partagez pas vos identifiants, mots de passe ou données bancaires.", "Vérifiez via le site officiel ou le numéro officiel de l’institution."],
      disclaimer: "Il s’agit d’une analyse de risque, pas d’une confirmation de l’authenticité du document."
    },
    IT: {
      LOW: "Sembra abbastanza credibile",
      MEDIUM: "Verifica il mittente",
      HIGH: "Alto rischio di frode",
      UNKNOWN: "Non è possibile valutare l’autenticità",
      summary: "Questa è un’analisi del rischio tranquilla. Non conferma l’autenticità del documento.",
      safeSteps: ["Non cliccare su link sospetti.", "Non condividere login, password o dati bancari.", "Verifica tramite il sito ufficiale o il numero ufficiale dell’istituzione."],
      disclaimer: "Questa è un’analisi del rischio, non una conferma dell’autenticità del documento."
    },
    ES: {
      LOW: "Parece bastante creíble",
      MEDIUM: "Verifica el remitente",
      HIGH: "Alto riesgo de fraude",
      UNKNOWN: "No se puede evaluar la autenticidad",
      summary: "Este es un análisis de riesgo tranquilo. No confirma la autenticidad del documento.",
      safeSteps: ["No hagas clic en enlaces sospechosos.", "No compartas usuario, contraseña ni datos bancarios.", "Verifica a través del sitio web oficial o el número oficial de la institución."],
      disclaimer: "Este es un análisis de riesgo, no una confirmación de la autenticidad del documento."
    },
    PT: {
      LOW: "Parece bastante credível",
      MEDIUM: "Verifique o remetente",
      HIGH: "Alto risco de fraude",
      UNKNOWN: "Não é possível avaliar a autenticidade",
      summary: "Esta é uma análise calma de risco. Não confirma a autenticidade do documento.",
      safeSteps: ["Não clique em links suspeitos.", "Não partilhe login, palavra-passe ou dados bancários.", "Verifique através do site oficial ou do número oficial da instituição."],
      disclaimer: "Esta é uma análise de risco, não uma confirmação da autenticidade do documento."
    }
  };

  const t = map[L] || map.PL;

  return {
    label: t[level] || t.UNKNOWN,
    summary: t.summary,
    safeSteps: t.safeSteps,
    disclaimer: t.disclaimer
  };
}

function buildReplies(lang, tone) {
  const L = (lang || "PL").toUpperCase();

  const replies = {
    PL: {
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
    },
    EN: {
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
    },
    NL: {
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
    },
    DE: {
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
    },
    UA: {
      neutral:
`Доброго дня,
дякую за повідомлення. Будь ласка, підтвердьте, чи потрібні від мене якісь дії та які строки діють.
З повагою,`,
      polite:
`Доброго дня,
будь ласка, підтвердьте, чи потрібні подальші кроки з мого боку і до якої дати.
З повагою,`,
      firm:
`Доброго дня,
прошу чітко вказати необхідні дії та строки.
З повагою,`
    },
    FR: {
      neutral:
`Bonjour,
merci pour votre message. Pouvez-vous confirmer si une action est attendue de ma part et quels sont les délais ?
Cordialement,`,
      polite:
`Bonjour,
pourriez-vous s’il vous plaît confirmer si des démarches supplémentaires sont nécessaires de ma part et avant quelle date ?
Cordialement,`,
      firm:
`Bonjour,
merci d’indiquer clairement les actions requises et les délais.
Cordialement,`
    },
    IT: {
      neutral:
`Buongiorno,
grazie per il messaggio. Potreste confermare se è richiesta un’azione da parte mia e quali sono le scadenze?
Cordiali saluti,`,
      polite:
`Buongiorno,
potreste cortesemente confermare se sono necessari ulteriori passi da parte mia e entro quale data?
Cordiali saluti,`,
      firm:
`Buongiorno,
vi chiedo di indicare chiaramente le azioni richieste e le relative scadenze.
Cordiali saluti,`
    },
    ES: {
      neutral:
`Buenos días,
gracias por su mensaje. ¿Podrían confirmar si se requiere alguna acción por mi parte y cuáles son los plazos?
Atentamente,`,
      polite:
`Buenos días,
¿podrían confirmar por favor si debo realizar algún paso adicional y antes de qué fecha?
Atentamente,`,
      firm:
`Buenos días,
por favor indiquen claramente las acciones requeridas y los plazos.
Atentamente,`
    },
    PT: {
      neutral:
`Bom dia,
obrigado pela mensagem. Poderia confirmar se é necessária alguma ação da minha parte e quais são os prazos?
Com os melhores cumprimentos,`,
      polite:
`Bom dia,
poderia confirmar, por favor, se são necessários mais passos da minha parte e até quando?
Com os melhores cumprimentos,`,
      firm:
`Bom dia,
por favor indique claramente as ações necessárias e os respetivos prazos.
Com os melhores cumprimentos,`
    }
  };

  return replies[L] || replies.PL;
}

async function callOpenAIJsonObject(apiKey, prompt) {
  const res = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${apiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model: "gpt-4o-mini",
      temperature: 0,
      max_output_tokens: 2200,
      input: prompt,
      text: { format: { type: "json_object" } }
    })
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`OpenAI error ${res.status}: ${JSON.stringify(data)}`);

  const raw = extractTextFromResponses(data);
  try {
    return JSON.parse(raw);
  } catch {
    const jsonText = extractJson(raw);
    return JSON.parse(jsonText);
  }
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
      max_output_tokens: 1400,
      input: prompt,
      text: { format: { type: "text" } }
    })
  });

  const data = await res.json().catch(() => ({}));
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
