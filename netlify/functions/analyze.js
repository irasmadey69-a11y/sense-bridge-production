// netlify/functions/analyze.js  (CommonJS)
// Sense Bridge — analiza pisma + spokojna analiza ryzyka oszustwa

exports.handler = async (event) => {
  const headers = corsHeaders();

  if (event.httpMethod === "OPTIONS") {
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


const sbFraudSyncV8 = sbApplyFraudLogicSyncV8({
  text,
  userLang,
  fraudRisk,
  institution,
  detectedLinks,
  risks,
  consequences,
  help,
  urgency,
  legalHelpFinal
});
if (sbFraudSyncV8) {
  risks = sbFraudSyncV8.risks || risks;
  consequences = sbFraudSyncV8.consequences || consequences;
  help = sbFraudSyncV8.help || help;
  urgency = sbFraudSyncV8.urgency || urgency;
  legalHelpFinal = sbFraudSyncV8.legalHelpFinal || legalHelpFinal;
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


/* ============================================================
   Sense Bridge ANALYZE LOGIC SYNC v8
   Strong phishing cannot be calmed down by known institution.
   No extra API calls. Local post-processing only.
   ============================================================ */

function sbFraudTextMapV8(lang) {
  const L = (lang || "PL").toUpperCase();
  const map = {
    PL: {
      highLabel: "Wysokie ryzyko phishingu lub podszywania się",
      highSummary: "Wiadomość zawiera kilka mocnych sygnałów oszustwa: presję czasu, prośbę o dane dostępowe lub nietypowy link.",
      risk1: "Nie klikaj linku z wiadomości.",
      risk2: "Nie podawaj loginu, hasła, kodu SMS ani TAN.",
      risk3: "Sprawdź sprawę wyłącznie przez oficjalną stronę lub aplikację instytucji.",
      consequence1: "Jeżeli podasz dane, ktoś może uzyskać dostęp do konta.",
      consequence2: "Dane mogą zostać wykorzystane do oszustwa lub kradzieży pieniędzy."
    },
    EN: {
      highLabel: "High phishing or impersonation risk",
      highSummary: "The message contains several strong fraud signals: time pressure, request for access details or an unusual link.",
      risk1: "Do not click the link in the message.",
      risk2: "Do not share login, password, SMS code or TAN.",
      risk3: "Check the matter only through the official website or app of the institution.",
      consequence1: "If you provide the data, someone may gain access to the account.",
      consequence2: "The data may be used for fraud or theft."
    },
    NL: {
      highLabel: "Hoog risico op phishing of imitatie",
      highSummary: "Het bericht bevat meerdere sterke fraudesignalen: tijdsdruk, vraag om toegangsgegevens of een ongebruikelijke link.",
      risk1: "Klik niet op de link in het bericht.",
      risk2: "Deel geen login, wachtwoord, sms-code of TAN.",
      risk3: "Controleer dit alleen via de officiële website of app van de instantie.",
      consequence1: "Als u gegevens invoert, kan iemand toegang krijgen tot het account.",
      consequence2: "De gegevens kunnen worden gebruikt voor fraude of diefstal."
    },
    DE: {
      highLabel: "Hohes Risiko für Phishing oder Identitätsmissbrauch",
      highSummary: "Die Nachricht enthält mehrere starke Betrugssignale: Zeitdruck, Aufforderung zu Zugangsdaten oder einen ungewöhnlichen Link.",
      risk1: "Klicken Sie nicht auf den Link in der Nachricht.",
      risk2: "Geben Sie keinen Login, kein Passwort, keinen SMS-Code und keine TAN weiter.",
      risk3: "Prüfen Sie die Sache nur über die offizielle Website oder App der Institution.",
      consequence1: "Wenn Sie Daten eingeben, kann jemand Zugriff auf das Konto erhalten.",
      consequence2: "Die Daten können für Betrug oder Diebstahl verwendet werden."
    },
    FR: {
      highLabel: "Risque élevé de phishing ou d’usurpation",
      highSummary: "Le message contient plusieurs signaux forts de fraude : pression temporelle, demande d’identifiants ou lien inhabituel.",
      risk1: "Ne cliquez pas sur le lien du message.",
      risk2: "Ne partagez pas votre identifiant, mot de passe, code SMS ou TAN.",
      risk3: "Vérifiez uniquement via le site ou l’application officielle de l’institution.",
      consequence1: "Si vous donnez ces données, quelqu’un peut accéder au compte.",
      consequence2: "Les données peuvent être utilisées pour une fraude ou un vol."
    },
    IT: {
      highLabel: "Alto rischio di phishing o impersonificazione",
      highSummary: "Il messaggio contiene diversi forti segnali di frode: pressione temporale, richiesta di dati di accesso o link insolito.",
      risk1: "Non cliccare sul link nel messaggio.",
      risk2: "Non condividere login, password, codice SMS o TAN.",
      risk3: "Verifica solo tramite il sito o l’app ufficiale dell’istituzione.",
      consequence1: "Se inserisci i dati, qualcuno potrebbe accedere al conto.",
      consequence2: "I dati possono essere usati per frode o furto."
    },
    ES: {
      highLabel: "Alto riesgo de phishing o suplantación",
      highSummary: "El mensaje contiene varias señales fuertes de fraude: presión de tiempo, solicitud de datos de acceso o enlace inusual.",
      risk1: "No hagas clic en el enlace del mensaje.",
      risk2: "No compartas usuario, contraseña, código SMS ni TAN.",
      risk3: "Verifica solo mediante el sitio web o la app oficial de la institución.",
      consequence1: "Si proporcionas los datos, alguien podría acceder a la cuenta.",
      consequence2: "Los datos pueden usarse para fraude o robo."
    },
    PT: {
      highLabel: "Alto risco de phishing ou falsificação",
      highSummary: "A mensagem contém vários sinais fortes de fraude: pressão de tempo, pedido de dados de acesso ou link invulgar.",
      risk1: "Não clique no link da mensagem.",
      risk2: "Não partilhe login, palavra-passe, código SMS ou TAN.",
      risk3: "Verifique apenas pelo site ou pela aplicação oficial da instituição.",
      consequence1: "Se fornecer os dados, alguém pode obter acesso à conta.",
      consequence2: "Os dados podem ser usados para fraude ou roubo."
    },
    UA: {
      highLabel: "Високий ризик фішингу або підробки",
      highSummary: "Повідомлення містить кілька сильних ознак шахрайства: тиск часу, запит даних доступу або незвичне посилання.",
      risk1: "Не натискайте посилання в повідомленні.",
      risk2: "Не передавайте логін, пароль, SMS-код або TAN.",
      risk3: "Перевіряйте лише через офіційний сайт або додаток установи.",
      consequence1: "Якщо ви введете дані, хтось може отримати доступ до акаунта.",
      consequence2: "Дані можуть бути використані для шахрайства або крадіжки."
    }
  };
  return map[L] || map.PL;
}

function sbDetectStrongPhishingV8(text, detectedLinks, institution) {
  const t = String(text || "").toLowerCase();
  const links = Array.isArray(detectedLinks) ? detectedLinks : [];

  const credential =
    /(tan|sms[\s-]*(code|kod|codigo|c[oó]digo|codice)|password|passwort|wachtwoord|hasło|senha|palavra[-\s]?passe|login|logowanie|access code|c[oó]digo de acesso|dane dostępowe|zugangsdaten|credenciais|credenziali)/i.test(t);

  const timePressure =
    /(24\s*(h|hours|uur|stunden|ore|horas|godzin)|12\s*(h|hours|uur|stunden|ore|horas)|immediately|urgent|urgente|dringend|sofort|natychmiast|onmiddellijk|imediatamente|immediat|binnen\s*24|within\s*24|dentro de\s*24|entro\s*24)/i.test(t);

  const accountThreat =
    /(account|konto|rekening|bankkonto|conta|compte|cuenta).{0,90}(suspend|suspended|suspenso|sospeso|gesperrt|blocked|block|zablok|deaktiv|deactiv|suspensão|sospensione|bloquead)/i.test(t) ||
    /(suspens|suspensão|sospensione|bloqueio|blocco|blokada|sperrung).{0,90}(account|konto|rekening|conta|bank)/i.test(t);

  const financialBrand =
    /(bank|banco|sparkasse|millennium|bcp|ing|rabobank|abn|paypal|creditcard|visa|mastercard|rekening|bankkonto|conta banc[aá]ria)/i.test(t);

  const rawSuspiciousLink =
    /(security|secure|verify|verifica|verification|verifizierung|login|check|account|konto|conta|bank).{0,80}\.(com|net|info|top|xyz|click|site|online|live|app)/i.test(t) ||
    /http:\/\/[^\s]+/i.test(t);

  let nonOfficialLink = false;
  try {
    const official = String(institution && institution.officialWebsite || "").toLowerCase();
    const officialHost = official ? new URL(official).hostname.replace(/^www\./, "") : "";
    for (const link of links) {
      try {
        const host = new URL(String(link)).hostname.replace(/^www\./, "").toLowerCase();
        if (officialHost && !host.endsWith(officialHost)) nonOfficialLink = true;
        if (!officialHost && /(security|verify|verifica|verification|login|check|secure)/i.test(host)) nonOfficialLink = true;
      } catch {}
    }
  } catch {}

  const suspiciousLink = rawSuspiciousLink || nonOfficialLink;

  const score = [credential, timePressure, accountThreat, financialBrand, suspiciousLink].filter(Boolean).length;

  return {
    credential,
    timePressure,
    accountThreat,
    financialBrand,
    suspiciousLink,
    score,
    hardHigh: credential && suspiciousLink && (timePressure || accountThreat || financialBrand),
    hardMedium: score >= 3
  };
}

function sbApplyFraudLogicSyncV8(ctx) {
  const {
    text,
    userLang,
    fraudRisk,
    institution,
    detectedLinks
  } = ctx || {};

  if (!fraudRisk) return ctx;

  const sig = sbDetectStrongPhishingV8(text, detectedLinks, institution);
  const labels = sbFraudTextMapV8(userLang);

  if (sig.hardHigh || sig.hardMedium) {
    fraudRisk.level = sig.hardHigh ? "HIGH" : "MEDIUM";
    fraudRisk.confidence = Math.max(Number(fraudRisk.confidence || 0), sig.hardHigh ? 90 : 78);
    fraudRisk.label = sig.hardHigh ? labels.highLabel : (fraudRisk.label || labels.highLabel);
    fraudRisk.summary = sig.hardHigh ? labels.highSummary : (fraudRisk.summary || labels.highSummary);

    const signals = Array.isArray(fraudRisk.signals) ? fraudRisk.signals : [];
    const extraSignals = [];
    if (sig.credential) extraSignals.push(labels.risk2);
    if (sig.timePressure) extraSignals.push("Presja czasu / time pressure / urgência.");
    if (sig.suspiciousLink) extraSignals.push(labels.risk1);
    if (sig.accountThreat) extraSignals.push("Groźba blokady lub utraty dostępu / account suspension threat.");

    fraudRisk.signals = Array.from(new Set([...signals, ...extraSignals])).slice(0, 8);

    const safeSteps = Array.isArray(fraudRisk.safeSteps) ? fraudRisk.safeSteps : [];
    fraudRisk.safeSteps = Array.from(new Set([
      labels.risk1,
      labels.risk2,
      labels.risk3,
      ...safeSteps
    ])).slice(0, 6);

    const suspicious = Array.isArray(fraudRisk.suspiciousElements) ? fraudRisk.suspiciousElements : [];
    const suspiciousExtra = [];
    if (sig.credential) suspiciousExtra.push(labels.risk2);
    if (sig.suspiciousLink) suspiciousExtra.push(labels.risk1);
    if (sig.timePressure) suspiciousExtra.push("Presja czasu / pilna weryfikacja.");
    fraudRisk.suspiciousElements = Array.from(new Set([...suspicious, ...suspiciousExtra])).slice(0, 8);

    if (Array.isArray(ctx.risks)) {
      ctx.risks = Array.from(new Set([
        labels.risk1,
        labels.risk2,
        labels.risk3,
        ...ctx.risks
      ])).slice(0, 8);
    }

    if (Array.isArray(ctx.consequences)) {
      ctx.consequences = Array.from(new Set([
        labels.consequence1,
        labels.consequence2,
        ...ctx.consequences
      ])).slice(0, 8);
    }

    if (Array.isArray(ctx.help)) {
      ctx.help = Array.from(new Set([
        labels.risk3,
        ...ctx.help
      ])).slice(0, 8);
    }

    if (ctx.urgency !== "HIGH") ctx.urgency = "HIGH";
    if (ctx.legalHelpFinal === "URGENT") ctx.legalHelpFinal = "RECOMMENDED";
  }

  return ctx;
}

