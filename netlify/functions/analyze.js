// netlify/functions/analyze.js  (CommonJS)
// Sense Bridge — analiza pisma + spokojna analiza ryzyka oszustwa

exports.handler = async (event) => {
  const headers = corsHeaders();

  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 200, headers, body: "" };
  }

  try {
    const body = safeJson(event.body);
    const mode = normalizeAnalysisMode(body.mode || body.analysisMode || body.toolMode || "letter");
    let text = str(body.text || body.input || body.content || body.document || "");
    text = stripLegacyModeInstruction(text, mode);
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
${buildModePrompt(mode, userLang)}

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
- DigiD, UWV, Belastingdienst, Toeslagen, Gemeente, IND, SVB, DUO, CJIB, RDW
- ING, Rabobank, ABN AMRO, ASN Bank
- tax offices / revenue agencies: IRS, CRA, HMRC, Impots.gouv.fr, SPF Finances, Agencia Tributaria, Finanzamt, Agenzia Entrate, Autoridade Tributaria, Skatteverket
- immigration offices: USCIS, IRCC, UK Home Office, IND, OFII, SEF/AIMA, Extranjeria, BAMF
- social security / benefits: Social Security Administration, Service Canada, Jobcenter, CAF, CPAM/Ameli, INPS, INSS, ZUS, UWV
- municipalities and official city halls / communes / gemeente / mairie / ayuntamiento / comune / camara municipal
- hospitals, universities and official public services when the official domain is clear
- European and international public institutions when confidently recognizable

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
    sbLocalTextV1(userLang, "suspiciousDomainOrPhone")
  ];
}

applyGlobalInstitutionRecognitionV2(institution, text, detectedLinks);
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

const sbImpersonationPatchV1 = sbApplyInstitutionImpersonationPatchV1({
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
if (sbImpersonationPatchV1) {
  risks = sbImpersonationPatchV1.risks || risks;
  consequences = sbImpersonationPatchV1.consequences || consequences;
  help = sbImpersonationPatchV1.help || help;
  urgency = sbImpersonationPatchV1.urgency || urgency;
  legalHelpFinal = sbImpersonationPatchV1.legalHelpFinal || legalHelpFinal;
}


const sbGlobalHighGuardV1 = sbApplyGlobalImpersonationHighGuardV1({
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
if (sbGlobalHighGuardV1) {
  risks = sbGlobalHighGuardV1.risks || risks;
  consequences = sbGlobalHighGuardV1.consequences || consequences;
  help = sbGlobalHighGuardV1.help || help;
  urgency = sbGlobalHighGuardV1.urgency || urgency;
  legalHelpFinal = sbGlobalHighGuardV1.legalHelpFinal || legalHelpFinal;
}

const sbGlobalScamLayerV1 = sbApplyGlobalScamLayerV1({
  text,
  userLang,
  fraudRisk,
  institution,
  detectedLinks,
  suspiciousLinks,
  risks,
  consequences,
  help,
  urgency,
  legalHelpFinal
});
if (sbGlobalScamLayerV1) {
  risks = sbGlobalScamLayerV1.risks || risks;
  consequences = sbGlobalScamLayerV1.consequences || consequences;
  help = sbGlobalScamLayerV1.help || help;
  urgency = sbGlobalScamLayerV1.urgency || urgency;
  legalHelpFinal = sbGlobalScamLayerV1.legalHelpFinal || legalHelpFinal;
}

calmOfficialFraudRiskAfterSync({
  fraudRisk,
  institution,
  detectedLinks,
  matchedSuspiciousLinks,
  suspiciousPhoneMatches,
  userLang,
  text
});

if (
  institution &&
  institution.officialWebsite &&
  Number(institution.confidence || 0) >= 85 &&
  !hasHardFraudSignalsForOfficial(text, detectedLinks, institution, matchedSuspiciousLinks, suspiciousPhoneMatches)
) {
  risks = softenRisksForOfficialInstitution(risks, userLang, institution);
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

    sbNormalizeLocalPostProcessLanguageV1(payload, userLang);

    forceUserLanguageNormalizationV2(payload, userLang);

    sbDedupePayloadArraysV1(payload);

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

function normalizeAnalysisMode(value) {
  const raw = String(value || "letter").trim().toLowerCase();
  const aliases = {
    letter: "letter",
    document: "letter",
    normal: "letter",
    contract: "contract",
    document_contract: "contract",
    pdf: "document_pdf",
    document_pdf: "document_pdf",
    form: "document_form",
    document_form: "document_form",
    photo: "document_photo",
    document_photo: "document_photo",
    bill: "document_bill",
    invoice: "document_bill",
    document_bill: "document_bill"
  };
  return aliases[raw] || "letter";
}

function stripLegacyModeInstruction(value, mode) {
  let text = String(value || "").trim();
  if (!mode || mode === "letter") return text;

  // Older index versions inserted an English mode instruction directly
  // before the real document. Remove only that known wrapper so it is not
  // translated or mistaken for document content.
  const marker = "DOCUMENT START:";
  const markerIndex = text.toUpperCase().indexOf(marker);
  if (markerIndex >= 0 && markerIndex < 1400) {
    text = text.slice(markerIndex + marker.length).trim();
  }
  return text;
}

function buildModePrompt(mode, userLang) {
  const common = `To NIE jest porada prawna, podatkowa ani finansowa.
Odpowiadaj w języku użytkownika: ${userLang}.
Nie wymyślaj danych, których nie ma w materiale. Wyraźnie zaznaczaj niepewność.`;

  const prompts = {
    letter: `Zadanie: przeanalizuj pismo urzędowe lub formalne.
Wyjaśnij jego znaczenie, nadawcę, oczekiwane działania, terminy, możliwe konsekwencje i bezpieczne kolejne kroki.`,

    contract: `TRYB ANALIZY UMOWY.
Rozpoznaj strony i rodzaj umowy. Wyjaśnij najważniejsze obowiązki, opłaty, terminy, czas trwania, wypowiedzenie, kary, automatyczne przedłużenie, niejasne lub jednostronne zapisy oraz praktyczne pytania, które użytkownik powinien zadać.
Nie stwierdzaj, że zapis jest legalny lub nielegalny, jeśli nie można tego pewnie ocenić.`,

    document_pdf: `TRYB ANALIZY DOKUMENTU PDF.
Rozpoznaj typ dokumentu, wystawcę, cel, najważniejsze fakty, daty, terminy, obowiązki, wymagane załączniki, niejasne miejsca, ryzyka i praktyczne kolejne kroki.
Jeśli tekst zawiera oznaczenia stron, połącz informacje z całego dokumentu i nie traktuj nagłówków stron jako osobnej treści.`,

    document_form: `TRYB POMOCY PRZY FORMULARZU.
Wyjaśnij cel formularza, widoczne pola i sekcje, jakie informacje należy w nich podać, które pola wyglądają na obowiązkowe, jakie dokumenty lub podpisy mogą być potrzebne oraz co zrobić dalej.
Nigdy nie wymyślaj danych osobowych użytkownika i nie wypełniaj brakujących informacji za niego.`,

    document_photo: `TRYB ANALIZY ZDJĘCIA Z TEKSTEM.
Wyjaśnij, co przedstawia sfotografowany materiał, uporządkuj odczytany tekst, rozpoznaj nadawcę lub źródło, jeśli to możliwe, wskaż ważne informacje, terminy, ostrzeżenia i bezpieczne kolejne kroki.
Uwzględnij możliwość błędów OCR i zaznacz fragmenty nieczytelne lub niepewne.`,

    document_bill: `TRYB ANALIZY RACHUNKU LUB FAKTURY.
Rozpoznaj dostawcę, odbiorcę, cel dokumentu, pozycje, kwoty netto i brutto, podatek/VAT, sumę, termin i sposób płatności, numer lub referencję płatności, opłaty cykliczne, kary, nietypowe pozycje i elementy wymagające sprawdzenia przed zapłatą.
Nie oceniaj poprawności podatkowej ani prawnej, jeśli dokument nie daje wystarczających danych.`
  };

  return `${prompts[mode] || prompts.letter}

${common}`;
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


/* ============================================================
   Sense Bridge GLOBAL INSTITUTION RECOGNITION v2
   Local safety layer. It does not replace AI analysis; it only
   fills or strengthens institution data when the text clearly
   matches a known official institution/domain.
   ============================================================ */

function applyGlobalInstitutionRecognitionV2(institution, text, detectedLinks) {
  if (!institution) return institution;

  const t = String(text || "").toLowerCase();
  const links = Array.isArray(detectedLinks) ? detectedLinks : [];
  const allHosts = links.map(sbHostFromGlobalLinkV2).filter(Boolean);

  const currentConfidence = Number(institution.confidence || 0);
  const currentName = String(institution.name || "").trim();
  const currentWebsite = String(institution.officialWebsite || "").trim();

  let best = null;
  for (const item of sbGlobalInstitutionRegistryV2()) {
    let score = 0;
    const hay = `${t} ${currentName.toLowerCase()} ${currentWebsite.toLowerCase()}`;

    for (const pattern of item.patterns || []) {
      if (pattern.test(hay)) score += 45;
    }

    const officialHost = sbHostFromGlobalLinkV2(item.officialWebsite);
    if (officialHost && allHosts.some(h => h === officialHost || h.endsWith("." + officialHost))) {
      score += 55;
    }

    if (currentWebsite && officialHost && sbHostFromGlobalLinkV2(currentWebsite).endsWith(officialHost)) {
      score += 30;
    }

    if (score > 0) {
      const confidence = Math.max(65, Math.min(96, score));
      if (!best || confidence > best.confidence) best = { ...item, confidence };
    }
  }

  if (!best) return institution;

  // Do not overwrite a strong AI result with a different local guess.
  if (currentName && currentConfidence >= 85 && !sbSameInstitutionNameV2(currentName, best.name)) {
    return institution;
  }

  institution.name = currentName || best.name;
  institution.country = institution.country || best.country;
  institution.officialWebsite = currentWebsite || best.officialWebsite;
  institution.confidence = Math.max(currentConfidence || 0, best.confidence);

  // If the text or link exactly points to an official domain, make confidence strong but not absolute.
  if (best.confidence >= 90 && institution.officialWebsite) {
    institution.confidence = Math.max(Number(institution.confidence || 0), 90);
  }

  return institution;
}

function sbSameInstitutionNameV2(a, b) {
  const x = String(a || "").toLowerCase().replace(/[^a-z0-9]+/g, "");
  const y = String(b || "").toLowerCase().replace(/[^a-z0-9]+/g, "");
  return !!x && !!y && (x.includes(y) || y.includes(x));
}

function sbHostFromGlobalLinkV2(link) {
  try {
    let raw = String(link || "").trim();
    if (!raw) return "";
    if (!/^https?:\/\//i.test(raw)) raw = "https://" + raw;
    return new URL(raw).hostname.replace(/^www\./i, "").toLowerCase();
  } catch {
    return "";
  }
}

function sbGlobalInstitutionRegistryV2() {
  return [
    // Netherlands
    { name:"DigiD", country:"NL", officialWebsite:"https://www.digid.nl", patterns:[/\bdigid\b/i] },
    { name:"UWV", country:"NL", officialWebsite:"https://www.uwv.nl", patterns:[/\buwv\b/i] },
    { name:"Belastingdienst", country:"NL", officialWebsite:"https://www.belastingdienst.nl", patterns:[/belastingdienst/i] },
    { name:"Dienst Toeslagen", country:"NL", officialWebsite:"https://www.toeslagen.nl", patterns:[/toeslagen/i] },
    { name:"IND", country:"NL", officialWebsite:"https://ind.nl", patterns:[/\bind\b|immigratie.*naturalisatie/i] },
    { name:"SVB", country:"NL", officialWebsite:"https://www.svb.nl", patterns:[/\bsvb\b|sociale verzekeringsbank/i] },
    { name:"DUO", country:"NL", officialWebsite:"https://www.duo.nl", patterns:[/\bduo\b|dienst uitvoering onderwijs/i] },
    { name:"CJIB", country:"NL", officialWebsite:"https://www.cjib.nl", patterns:[/\bcjib\b/i] },
    { name:"RDW", country:"NL", officialWebsite:"https://www.rdw.nl", patterns:[/\brdw\b/i] },
    { name:"PostNL", country:"NL", officialWebsite:"https://www.postnl.nl", patterns:[/postnl/i] },

    // United States
    { name:"Internal Revenue Service", country:"US", officialWebsite:"https://www.irs.gov", patterns:[/\birs\b|internal revenue service/i] },
    { name:"Social Security Administration", country:"US", officialWebsite:"https://www.ssa.gov", patterns:[/social security administration|\bssa\b/i] },
    { name:"USCIS", country:"US", officialWebsite:"https://www.uscis.gov", patterns:[/\buscis\b|u\.s\. citizenship and immigration services|citizenship and immigration services/i] },
    { name:"U.S. Department of State", country:"US", officialWebsite:"https://travel.state.gov", patterns:[/department of state|travel\.state\.gov/i] },
    { name:"Medicare", country:"US", officialWebsite:"https://www.medicare.gov", patterns:[/\bmedicare\b/i] },

    // Canada
    { name:"Canada Revenue Agency", country:"CA", officialWebsite:"https://www.canada.ca", patterns:[/canada revenue agency|\bcra\b|agence du revenu du canada/i] },
    { name:"Service Canada", country:"CA", officialWebsite:"https://www.canada.ca", patterns:[/service canada/i] },
    { name:"IRCC", country:"CA", officialWebsite:"https://www.canada.ca", patterns:[/\bircc\b|immigration, refugees and citizenship canada|immigration refugees and citizenship canada/i] },

    // United Kingdom / Ireland
    { name:"HM Revenue & Customs", country:"GB", officialWebsite:"https://www.gov.uk", patterns:[/hm revenue|hmrc|hm revenue & customs/i] },
    { name:"UK Home Office", country:"GB", officialWebsite:"https://www.gov.uk", patterns:[/home office|uk visas and immigration|\bukvi\b/i] },
    { name:"NHS", country:"GB", officialWebsite:"https://www.nhs.uk", patterns:[/\bnhs\b|national health service/i] },
    { name:"Department of Social Protection", country:"IE", officialWebsite:"https://www.gov.ie", patterns:[/department of social protection|\bmywelfare\b/i] },
    { name:"Revenue Ireland", country:"IE", officialWebsite:"https://www.revenue.ie", patterns:[/revenue commissioners|revenue ireland|\brevenue\b.*ireland/i] },

    // France / Belgium / Luxembourg
    { name:"Impots.gouv.fr", country:"FR", officialWebsite:"https://www.impots.gouv.fr", patterns:[/imp[oô]ts\.gouv|direction générale des finances publiques|dgfip/i] },
    { name:"CAF", country:"FR", officialWebsite:"https://www.caf.fr", patterns:[/\bcaf\b|caisse d allocations familiales|allocations familiales/i] },
    { name:"Ameli / Assurance Maladie", country:"FR", officialWebsite:"https://www.ameli.fr", patterns:[/\bameli\b|assurance maladie|cpam/i] },
    { name:"France Travail", country:"FR", officialWebsite:"https://www.francetravail.fr", patterns:[/france travail|p[oô]le emploi/i] },
    { name:"ANTS", country:"FR", officialWebsite:"https://ants.gouv.fr", patterns:[/\bants\b|agence nationale des titres sécurisés/i] },
    { name:"SPF Finances", country:"BE", officialWebsite:"https://finances.belgium.be", patterns:[/spf finances|fod financi[eë]n|finances\.belgium/i] },
    { name:"ONEM / RVA", country:"BE", officialWebsite:"https://www.onem.be", patterns:[/\bonem\b|\brva\b|office national de l'emploi|rijksdienst voor arbeidsvoorziening/i] },
    { name:"SPF Justice", country:"BE", officialWebsite:"https://justice.belgium.be", patterns:[/spf justice|fod justitie|justice\.belgium/i] },
    { name:"MyGuichet.lu", country:"LU", officialWebsite:"https://guichet.public.lu", patterns:[/myguichet|guichet\.public\.lu/i] },

    // Germany / Austria / Switzerland
    { name:"Finanzamt / ELSTER", country:"DE", officialWebsite:"https://www.elster.de", patterns:[/\bfinanzamt\b|\belster\b|bundeszentralamt für steuern|bzst/i] },
    { name:"Bundesagentur für Arbeit", country:"DE", officialWebsite:"https://www.arbeitsagentur.de", patterns:[/arbeitsagentur|bundesagentur für arbeit/i] },
    { name:"Jobcenter", country:"DE", officialWebsite:"https://www.jobcenter.digital", patterns:[/\bjobcenter\b/i] },
    { name:"BAMF", country:"DE", officialWebsite:"https://www.bamf.de", patterns:[/\bbamf\b|bundesamt für migration und flüchtlinge/i] },
    { name:"FinanzOnline", country:"AT", officialWebsite:"https://finanzonline.bmf.gv.at", patterns:[/finanzonline|bundesministerium für finanzen|bmf\.gv\.at/i] },
    { name:"AMS", country:"AT", officialWebsite:"https://www.ams.at", patterns:[/\bams\b|arbeitsmarktservice/i] },
    { name:"AHV/IV", country:"CH", officialWebsite:"https://www.ahv-iv.ch", patterns:[/ahv|\biv\b|avs|ai suisse/i] },
    { name:"ch.ch", country:"CH", officialWebsite:"https://www.ch.ch", patterns:[/\bch\.ch\b|swiss authorities|schweizer behörden/i] },

    // Spain / Portugal / Italy
    { name:"Agencia Tributaria", country:"ES", officialWebsite:"https://sede.agenciatributaria.gob.es", patterns:[/agencia tributaria|aeat|sede\.agenciatributaria/i] },
    { name:"Seguridad Social", country:"ES", officialWebsite:"https://www.seg-social.es", patterns:[/seguridad social|tesorería general de la seguridad social|tgss/i] },
    { name:"SEPE", country:"ES", officialWebsite:"https://www.sepe.es", patterns:[/\bsepe\b|servicio público de empleo estatal/i] },
    { name:"DGT", country:"ES", officialWebsite:"https://www.dgt.es", patterns:[/\bdgt\b|dirección general de tráfico/i] },
    { name:"Autoridade Tributária e Aduaneira", country:"PT", officialWebsite:"https://www.portaldasfinancas.gov.pt", patterns:[/autoridade tribut[áa]ria|portal das finan[çc]as|portaldasfinancas/i] },
    { name:"Segurança Social", country:"PT", officialWebsite:"https://www.seg-social.pt", patterns:[/seguran[çc]a social|seg-social\.pt/i] },
    { name:"AIMA", country:"PT", officialWebsite:"https://aima.gov.pt", patterns:[/\baima\b|agência para a integração migrações e asilo|agencia para a integracao migracoes e asilo/i] },
    { name:"Agenzia delle Entrate", country:"IT", officialWebsite:"https://www.agenziaentrate.gov.it", patterns:[/agenzia delle entrate|agenziaentrate/i] },
    { name:"INPS", country:"IT", officialWebsite:"https://www.inps.it", patterns:[/\binps\b|istituto nazionale previdenza sociale/i] },
    { name:"INAIL", country:"IT", officialWebsite:"https://www.inail.it", patterns:[/\binail\b/i] },
    { name:"Ministero dell'Interno", country:"IT", officialWebsite:"https://www.interno.gov.it", patterns:[/ministero dell.?interno|permesso di soggiorno|questura/i] },

    // Poland / Ukraine
    { name:"ZUS", country:"PL", officialWebsite:"https://www.zus.pl", patterns:[/\bzus\b|zakład ubezpieczeń społecznych|zaklad ubezpieczen spolecznych/i] },
    { name:"Urząd Skarbowy / podatki.gov.pl", country:"PL", officialWebsite:"https://www.podatki.gov.pl", patterns:[/urząd skarbowy|urzad skarbowy|podatki\.gov\.pl|ministerstwo finansów/i] },
    { name:"mObywatel", country:"PL", officialWebsite:"https://www.gov.pl", patterns:[/mobywatel|gov\.pl/i] },
    { name:"Diia", country:"UA", officialWebsite:"https://diia.gov.ua", patterns:[/\bdiia\b|дія|diia\.gov\.ua/i] },
    { name:"State Tax Service of Ukraine", country:"UA", officialWebsite:"https://tax.gov.ua", patterns:[/tax\.gov\.ua|державна податкова служба/i] },

    // Scandinavia / Baltics
    { name:"Skatteverket", country:"SE", officialWebsite:"https://www.skatteverket.se", patterns:[/skatteverket/i] },
    { name:"Försäkringskassan", country:"SE", officialWebsite:"https://www.forsakringskassan.se", patterns:[/försäkringskassan|forsakringskassan/i] },
    { name:"NAV", country:"NO", officialWebsite:"https://www.nav.no", patterns:[/\bnav\b|arbeids- og velferdsetaten/i] },
    { name:"Skatteetaten", country:"NO", officialWebsite:"https://www.skatteetaten.no", patterns:[/skatteetaten/i] },
    { name:"Skattestyrelsen", country:"DK", officialWebsite:"https://skat.dk", patterns:[/skattestyrelsen|skat\.dk/i] },
    { name:"Kela", country:"FI", officialWebsite:"https://www.kela.fi", patterns:[/\bkela\b|kansaneläkelaitos/i] },
    { name:"Vero Skatt", country:"FI", officialWebsite:"https://www.vero.fi", patterns:[/\bvero\b|vero\.fi/i] },
    { name:"Maksu- ja Tolliamet", country:"EE", officialWebsite:"https://www.emta.ee", patterns:[/emta\.ee|maksu- ja tolliamet/i] },

    // International / EU
    { name:"European Commission", country:"EU", officialWebsite:"https://commission.europa.eu", patterns:[/european commission|commission\.europa\.eu/i] },
    { name:"European Parliament", country:"EU", officialWebsite:"https://www.europarl.europa.eu", patterns:[/european parliament|europarl\.europa/i] },
    { name:"Court of Justice of the European Union", country:"EU", officialWebsite:"https://curia.europa.eu", patterns:[/court of justice of the european union|curia\.europa/i] },
    { name:"Europol", country:"EU", officialWebsite:"https://www.europol.europa.eu", patterns:[/europol/i] },
    { name:"WHO", country:"INT", officialWebsite:"https://www.who.int", patterns:[/world health organization|\bwho\b/i] }
  ];
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
  const strongKnownInstitution = institution && institution.officialWebsite && Number(institution.confidence || 0) >= 85;
  const hasKnownBad = (matchedSuspiciousLinks || []).length > 0 || (suspiciousPhoneMatches || []).length > 0;

  let sig = { hardHigh:false, hardMedium:false, credential:false, suspiciousLink:false, timePressure:false, accountThreat:false, financialBrand:false, score:0 };
  try {
    sig = sbDetectStrongPhishingV8(text, detectedLinks, institution);
  } catch {}

  /*
    Important distinction:
    - payment, tax, debt or official deadline can be ADMINISTRATIVE risk
    - it is NOT automatically fraud risk
    Fraud should stay high mainly when there are hard phishing signals:
    login/password/SMS/TAN + suspicious link + pressure/account threat.
  */
  const hardFraudSignal = hasKnownBad || sig.hardHigh || (
    sig.credential && sig.suspiciousLink && (sig.timePressure || sig.accountThreat || sig.financialBrand)
  );

  const softFraudSignal = sig.hardMedium || (
    sig.suspiciousLink && (sig.timePressure || sig.accountThreat)
  );

  if (strongKnownInstitution && !hardFraudSignal && !softFraudSignal) {
    fraudRisk.level = "LOW";
    fraudRisk.confidence = officialInstitutionConfidence(institution);
    fraudRisk.label = officialInstitutionLabel(userLang, institution.name);
    fraudRisk.summary = officialInstitutionSummary(userLang, institution.name);
    fraudRisk.suspiciousElements = [];
    fraudRisk.signals = filterAlarmSignals(fraudRisk.signals);
    fraudRisk.safeSteps = officialInstitutionSafeSteps(userLang, institution);
    return;
  }

  if (knownInstitution && fraudRisk.level === "HIGH" && !hardFraudSignal) {
    fraudRisk.level = "MEDIUM";
    fraudRisk.confidence = Math.min(Number(fraudRisk.confidence || 70), 70);
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


function hasHardFraudSignalsForOfficial(text, detectedLinks, institution, matchedSuspiciousLinks, suspiciousPhoneMatches) {
  const hasKnownBad = (matchedSuspiciousLinks || []).length > 0 || (suspiciousPhoneMatches || []).length > 0;
  if (hasKnownBad) return true;
  try {
    const impersonation = sbDetectInstitutionImpersonationPatchV1(text, detectedLinks, institution);
    if (impersonation && impersonation.minimumMedium) return true;
  } catch {}
  try {
    const sig = sbDetectStrongPhishingV8(text, detectedLinks, institution);
    return !!(sig.hardHigh || (sig.credential && sig.suspiciousLink && (sig.timePressure || sig.accountThreat || sig.financialBrand)));
  } catch {
    return false;
  }
}

function calmOfficialFraudRiskAfterSync(ctx) {
  const { fraudRisk, institution, detectedLinks, matchedSuspiciousLinks, suspiciousPhoneMatches, userLang, text } = ctx || {};
  if (!fraudRisk || !institution) return;
  const strongKnownInstitution = institution.officialWebsite && Number(institution.confidence || 0) >= 85;
  if (!strongKnownInstitution) return;

  const hard = hasHardFraudSignalsForOfficial(text, detectedLinks, institution, matchedSuspiciousLinks, suspiciousPhoneMatches);
  if (hard) return;

  fraudRisk.level = "LOW";
  fraudRisk.confidence = officialInstitutionConfidence(institution);
  fraudRisk.label = officialInstitutionLabel(userLang, institution.name);
  fraudRisk.summary = officialInstitutionSummary(userLang, institution.name);
  fraudRisk.signals = filterAlarmSignals(fraudRisk.signals);
  fraudRisk.suspiciousElements = [];
  fraudRisk.safeSteps = officialInstitutionSafeSteps(userLang, institution);
}

function softenRisksForOfficialInstitution(risks, lang, institution) {
  const L = (lang || "PL").toUpperCase();
  const cleaned = arr(risks).filter(r =>
    !/możliwość oszustwa|oszustw|phishing|scam|fraud|fałsz|fausse|frode|estafa|betrug/i.test(r)
  );

  const name = institution && institution.name ? institution.name : "";
  const officialStep = {
    PL: `Nie wykryto typowych sygnałów phishingu. Dla pewności sprawdź sprawę przez oficjalną stronę ${name}.`,
    EN: `No typical phishing signals were detected. If unsure, verify through the official website of ${name}.`,
    NL: `Er zijn geen typische phishing-signalen gevonden. Controleer bij twijfel via de officiële website van ${name}.`,
    DE: `Es wurden keine typischen Phishing-Signale erkannt. Prüfen Sie bei Zweifel über die offizielle Website von ${name}.`,
    FR: `Aucun signal typique de phishing n’a été détecté. En cas de doute, vérifiez via le site officiel de ${name}.`,
    IT: `Non sono stati rilevati segnali tipici di phishing. In caso di dubbio, verifica tramite il sito ufficiale di ${name}.`,
    ES: `No se detectaron señales típicas de phishing. En caso de duda, verifica a través del sitio oficial de ${name}.`,
    PT: `Não foram detetados sinais típicos de phishing. Em caso de dúvida, verifique pelo site oficial de ${name}.`,
    UA: `Типових ознак фішингу не виявлено. Якщо є сумніви, перевірте через офіційний сайт ${name}.`
  };

  if (!cleaned.length) return [officialStep[L] || officialStep.PL];
  return cleaned.slice(0, 5);
}



function officialInstitutionLabel(lang, institutionName) {
  const L = (lang || "PL").toUpperCase();
  const name = institutionName || "";
  const suffix = name ? ` – ${name}` : "";
  const map = {
    PL: `✅ Oficjalna instytucja rozpoznana${suffix}`,
    EN: `✅ Official institution recognized${suffix}`,
    NL: `✅ Officiële instantie herkend${suffix}`,
    DE: `✅ Offizielle Institution erkannt${suffix}`,
    FR: `✅ Institution officielle reconnue${suffix}`,
    IT: `✅ Istituzione ufficiale riconosciuta${suffix}`,
    ES: `✅ Institución oficial reconocida${suffix}`,
    PT: `✅ Instituição oficial reconhecida${suffix}`,
    UA: `✅ Офіційну установу розпізнано${suffix}`
  };
  return map[L] || map.PL;
}

function officialInstitutionSummary(lang, institutionName) {
  const L = (lang || "PL").toUpperCase();
  const name = institutionName || "the institution";
  const map = {
    PL: `Rozpoznano oficjalną instytucję ${name} i nie wykryto typowych sygnałów phishingu. Nadal warto sprawdzić szczegóły dokumentu przez oficjalną stronę tej instytucji.`,
    EN: `Official institution ${name} was recognized and no typical phishing signals were detected. Still verify the document details through the official website of this institution.`,
    NL: `Officiële instantie ${name} is herkend en er zijn geen typische phishing-signalen gevonden. Controleer de details nog steeds via de officiële website van deze instantie.`,
    DE: `Die offizielle Institution ${name} wurde erkannt und es wurden keine typischen Phishing-Signale gefunden. Prüfen Sie die Details trotzdem über die offizielle Website dieser Institution.`,
    FR: `L’institution officielle ${name} a été reconnue et aucun signal typique de phishing n’a été détecté. Vérifiez tout de même les détails via le site officiel de cette institution.`,
    IT: `L’istituzione ufficiale ${name} è stata riconosciuta e non sono stati rilevati segnali tipici di phishing. Verifica comunque i dettagli tramite il sito ufficiale dell’istituzione.`,
    ES: `La institución oficial ${name} fue reconocida y no se detectaron señales típicas de phishing. Aun así, verifica los detalles del documento a través del sitio oficial de la institución.`,
    PT: `A instituição oficial ${name} foi reconhecida e não foram detetados sinais típicos de phishing. Ainda assim, verifique os detalhes pelo site oficial da instituição.`,
    UA: `Офіційну установу ${name} розпізнано, типових ознак фішингу не виявлено. Все одно перевірте деталі документа через офіційний сайт цієї установи.`
  };
  return map[L] || map.PL;
}

function officialInstitutionConfidence(institution) {
  const c = Number(institution && institution.confidence || 0);
  if (!Number.isFinite(c) || c <= 0) return 85;
  return Math.max(85, Math.min(95, Math.round(c)));
}

function officialInstitutionSafeSteps(lang, institution) {
  const L = (lang || "PL").toUpperCase();
  const name = institution && institution.name ? institution.name : "";
  const website = institution && institution.officialWebsite ? institution.officialWebsite : "";
  const label = name || "instytucji";
  const map = {
    PL: [
      `Sprawdź dokument przez oficjalną stronę ${label}.`,
      website ? `Otwórz ręcznie: ${website}` : "Otwórz oficjalną stronę ręcznie.",
      "Nie używaj linków z wiadomości, jeśli domena wygląda inaczej niż oficjalna."
    ],
    EN: [
      `Verify the document through the official website of ${label}.`,
      website ? `Open manually: ${website}` : "Open the official website manually.",
      "Do not use links from the message if the domain looks different from the official one."
    ],
    NL: [
      `Controleer het document via de officiële website van ${label}.`,
      website ? `Open handmatig: ${website}` : "Open de officiële website handmatig.",
      "Gebruik geen links uit het bericht als het domein anders lijkt dan het officiële domein."
    ],
    DE: [
      `Prüfen Sie das Dokument über die offizielle Website von ${label}.`,
      website ? `Manuell öffnen: ${website}` : "Öffnen Sie die offizielle Website manuell.",
      "Verwenden Sie keine Links aus der Nachricht, wenn die Domain anders aussieht als die offizielle."
    ],
    FR: [
      `Vérifiez le document via le site officiel de ${label}.`,
      website ? `Ouvrez manuellement : ${website}` : "Ouvrez le site officiel manuellement.",
      "N’utilisez pas les liens du message si le domaine semble différent du domaine officiel."
    ],
    IT: [
      `Verifica il documento tramite il sito ufficiale di ${label}.`,
      website ? `Apri manualmente: ${website}` : "Apri manualmente il sito ufficiale.",
      "Non usare i link del messaggio se il dominio sembra diverso da quello ufficiale."
    ],
    ES: [
      `Verifica el documento a través del sitio oficial de ${label}.`,
      website ? `Abre manualmente: ${website}` : "Abre manualmente el sitio oficial.",
      "No uses enlaces del mensaje si el dominio parece diferente al oficial."
    ],
    PT: [
      `Verifique o documento pelo site oficial de ${label}.`,
      website ? `Abra manualmente: ${website}` : "Abra manualmente o site oficial.",
      "Não use links da mensagem se o domínio parecer diferente do oficial."
    ],
    UA: [
      `Перевірте документ через офіційний сайт ${label}.`,
      website ? `Відкрийте вручну: ${website}` : "Відкрийте офіційний сайт вручну.",
      "Не використовуйте посилання з повідомлення, якщо домен відрізняється від офіційного."
    ]
  };
  return map[L] || map.PL;
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
      timePressure: "Presja czasu lub pilna weryfikacja.",
      accountThreat: "Groźba blokady lub utraty dostępu.",
      consequence1: "Jeżeli podasz dane, ktoś może uzyskać dostęp do konta.",
      consequence2: "Dane mogą zostać wykorzystane do oszustwa lub kradzieży pieniędzy."
    },
    EN: {
      highLabel: "High phishing or impersonation risk",
      highSummary: "The message contains several strong fraud signals: time pressure, request for access details or an unusual link.",
      risk1: "Do not click the link in the message.",
      risk2: "Do not share login, password, SMS code or TAN.",
      risk3: "Check the matter only through the official website or app of the institution.",
      timePressure: "Time pressure or urgent verification.",
      accountThreat: "Threat of account suspension or loss of access.",
      consequence1: "If you provide the data, someone may gain access to the account.",
      consequence2: "The data may be used for fraud or theft."
    },
    NL: {
      highLabel: "Hoog risico op phishing of imitatie",
      highSummary: "Het bericht bevat meerdere sterke fraudesignalen: tijdsdruk, vraag om toegangsgegevens of een ongebruikelijke link.",
      risk1: "Klik niet op de link in het bericht.",
      risk2: "Deel geen login, wachtwoord, sms-code of TAN.",
      risk3: "Controleer dit alleen via de officiële website of app van de instantie.",
      timePressure: "Tijdsdruk of dringende verificatie.",
      accountThreat: "Dreiging van blokkade of verlies van toegang.",
      consequence1: "Als u gegevens invoert, kan iemand toegang krijgen tot het account.",
      consequence2: "De gegevens kunnen worden gebruikt voor fraude of diefstal."
    },
    DE: {
      highLabel: "Hohes Risiko für Phishing oder Identitätsmissbrauch",
      highSummary: "Die Nachricht enthält mehrere starke Betrugssignale: Zeitdruck, Aufforderung zu Zugangsdaten oder einen ungewöhnlichen Link.",
      risk1: "Klicken Sie nicht auf den Link in der Nachricht.",
      risk2: "Geben Sie keinen Login, kein Passwort, keinen SMS-Code und keine TAN weiter.",
      risk3: "Prüfen Sie die Sache nur über die offizielle Website oder App der Institution.",
      timePressure: "Zeitdruck oder dringende Verifizierung.",
      accountThreat: "Drohung mit Sperrung oder Zugangsverlust.",
      consequence1: "Wenn Sie Daten eingeben, kann jemand Zugriff auf das Konto erhalten.",
      consequence2: "Die Daten können für Betrug oder Diebstahl verwendet werden."
    },
    FR: {
      highLabel: "Risque élevé de phishing ou d’usurpation",
      highSummary: "Le message contient plusieurs signaux forts de fraude : pression temporelle, demande d’identifiants ou lien inhabituel.",
      risk1: "Ne cliquez pas sur le lien du message.",
      risk2: "Ne partagez pas votre identifiant, mot de passe, code SMS ou TAN.",
      risk3: "Vérifiez uniquement via le site ou l’application officielle de l’institution.",
      timePressure: "Pression temporelle ou vérification urgente.",
      accountThreat: "Menace de blocage ou de perte d’accès.",
      consequence1: "Si vous donnez ces données, quelqu’un peut accéder au compte.",
      consequence2: "Les données peuvent être utilisées pour une fraude ou un vol."
    },
    IT: {
      highLabel: "Alto rischio di phishing o impersonificazione",
      highSummary: "Il messaggio contiene diversi forti segnali di frode: pressione temporale, richiesta di dati di accesso o link insolito.",
      risk1: "Non cliccare sul link nel messaggio.",
      risk2: "Non condividere login, password, codice SMS o TAN.",
      risk3: "Verifica solo tramite il sito o l’app ufficiale dell’istituzione.",
      timePressure: "Pressione temporale o verifica urgente.",
      accountThreat: "Minaccia di blocco o perdita di accesso.",
      consequence1: "Se inserisci i dati, qualcuno potrebbe accedere al conto.",
      consequence2: "I dati possono essere usati per frode o furto."
    },
    ES: {
      highLabel: "Alto riesgo de phishing o suplantación",
      highSummary: "El mensaje contiene varias señales fuertes de fraude: presión de tiempo, solicitud de datos de acceso o enlace inusual.",
      risk1: "No hagas clic en el enlace del mensaje.",
      risk2: "No compartas usuario, contraseña, código SMS ni TAN.",
      risk3: "Verifica solo mediante el sitio web o la app oficial de la institución.",
      timePressure: "Presión de tiempo o verificación urgente.",
      accountThreat: "Amenaza de bloqueo o pérdida de acceso.",
      consequence1: "Si proporcionas los datos, alguien podría acceder a la cuenta.",
      consequence2: "Los datos pueden usarse para fraude o robo."
    },
    PT: {
      highLabel: "Alto risco de phishing ou falsificação",
      highSummary: "A mensagem contém vários sinais fortes de fraude: pressão de tempo, pedido de dados de acesso ou link invulgar.",
      risk1: "Não clique no link da mensagem.",
      risk2: "Não partilhe login, palavra-passe, código SMS ou TAN.",
      risk3: "Verifique apenas pelo site ou pela aplicação oficial da instituição.",
      timePressure: "Pressão de tempo ou verificação urgente.",
      accountThreat: "Ameaça de bloqueio ou perda de acesso.",
      consequence1: "Se fornecer os dados, alguém pode obter acesso à conta.",
      consequence2: "Os dados podem ser usados para fraude ou roubo."
    },
    UA: {
      highLabel: "Високий ризик фішингу або підробки",
      highSummary: "Повідомлення містить кілька сильних ознак шахрайства: тиск часу, запит даних доступу або незвичне посилання.",
      risk1: "Не натискайте посилання в повідомленні.",
      risk2: "Не передавайте логін, пароль, SMS-код або TAN.",
      risk3: "Перевіряйте лише через офіційний сайт або додаток установи.",
      timePressure: "Тиск часу або термінова перевірка.",
      accountThreat: "Погроза блокування або втрати доступу.",
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
    /((2|3|6|8|12|24)\s*(h|hours|hour|uur|stunden|ore|heures|horas|godzin)|dans un délai de\s*(2|3|6|8|12|24)\s*heures|within\s*(2|3|6|8|12|24)\s*hours|binnen\s*(2|3|6|8|12|24)\s*uur|dentro de\s*(2|3|6|8|12|24)\s*horas|entro\s*(2|3|6|8|12|24)\s*ore|immediately|urgent|urgente|dringend|sofort|natychmiast|onmiddellijk|imediatamente|immediat)/i.test(t);

  const accountThreat =
    /(account|konto|rekening|bankkonto|conta|compte|cuenta).{0,90}(suspend|suspended|suspenso|sospeso|gesperrt|blocked|block|zablok|deaktiv|deactiv|suspensão|sospensione|bloquead)/i.test(t) ||
    /(suspens|suspensão|sospensione|bloqueio|blocco|blokada|sperrung).{0,90}(account|konto|rekening|conta|bank)/i.test(t);

  const financialBrand =
    /(bank|banco|sparkasse|millennium|bcp|ing|rabobank|abn|paypal|creditcard|visa|mastercard|rekening|bankkonto|conta banc[aá]ria)/i.test(t);

  const rawSuspiciousLink =
    /(security|secure|verify|verifica|verification|verifizierung|login|check|account|konto|conta|bank|belastingdienst|digid|uwv|toeslagen|direct|betalen|controle).{0,80}\.(com|net|info|top|xyz|click|site|online|live|app)/i.test(t) ||
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


/* ============================================================
   Sense Bridge INSTITUTION IMPERSONATION PATCH v1
   Small local overlay: known institution + non-official domain
   should not be calmed down to LOW.
   ============================================================ */

function sbExtractLinksFromTextPatchV1(text) {
  const t = String(text || "");
  const matches = t.match(/(?:https?:\/\/|www\.)[^\s<>()"']+|\b[a-z0-9][a-z0-9-]{1,}\.[a-z]{2,}(?:\/[^\s<>()"']*)?/gi) || [];
  return matches
    .map(x => String(x || "").replace(/[.,;:!?\])}]+$/g, "").trim())
    .filter(Boolean);
}

function sbHostFromLinkPatchV1(link) {
  try {
    let raw = String(link || "").trim();
    if (!raw) return "";
    if (!/^https?:\/\//i.test(raw)) raw = "https://" + raw;
    return new URL(raw).hostname.replace(/^www\./i, "").toLowerCase();
  } catch {
    return "";
  }
}

function sbOfficialHostPatchV1(institution) {
  try {
    const official = String(institution && institution.officialWebsite || "").trim();
    if (!official) return "";
    return new URL(official).hostname.replace(/^www\./i, "").toLowerCase();
  } catch {
    return "";
  }
}

function sbDetectInstitutionImpersonationPatchV1(text, detectedLinks, institution) {
  const t = String(text || "").toLowerCase();
  const instName = String(institution && institution.name || "").toLowerCase();
  const officialHost = sbOfficialHostPatchV1(institution);
  const confidence = Number(institution && institution.confidence || 0);

  const knownInstitutionText = /(belastingdienst|digid|uwv|toeslagen|ing|rabobank|abn\s*amro|asn\s*bank|postnl|gemeente|ind|svb|duo|cjib|rdw)/i.test(t + " " + instName);
  const knownInstitution = knownInstitutionText || (!!officialHost && confidence >= 75);
  if (!knownInstitution) return { minimumMedium:false, high:false, externalLinks:[], suspiciousScore:0 };

  const links = Array.from(new Set([
    ...(Array.isArray(detectedLinks) ? detectedLinks : []),
    ...sbExtractLinksFromTextPatchV1(text)
  ].map(x => String(x || "").trim()).filter(Boolean)));

  const externalLinks = [];
  for (const link of links) {
    const host = sbHostFromLinkPatchV1(link);
    if (!host) continue;
    if (officialHost && !host.endsWith(officialHost)) externalLinks.push(link);
    if (!officialHost && /(secure|verify|verificatie|login|direct|betalen|payment|account|update|controle|check)/i.test(host)) externalLinks.push(link);
  }

  const hasExternal = externalLinks.length > 0;
  const credential = /(tan|sms[\s-]*(code|kod)|password|passwort|wachtwoord|hasło|login|digid-login|gegevens|dane dostępowe|inloggen|log in)/i.test(t);
  const timePressure = /(binnen\s*(2|3|6|8|12|24)\s*uur|within\s*(2|3|6|8|12|24)\s*hours|24\s*(h|uur|hours)|direct|onmiddellijk|urgent|dringend|laatste kans|natychmiast)/i.test(t);
  const accountThreat = /(account|digid|konto|rekening).{0,90}(blok|blocked|geblokkeerd|geschorst|suspend|deactiv|deaktiv|zamknięt|zablok)/i.test(t);
  const payment = /(betaal|betaling|betalen|pay|payment|iban|rekeningnummer|overmaken|schuld|boete|487|€|eur)/i.test(t);
  const fakeDomainWords = /(belastingdienst|digid|uwv|toeslagen|ing|rabobank|postnl|direct|secure|verify|verificatie|login|betalen|controle)/i.test(externalLinks.join(" "));

  const suspiciousScore = [hasExternal, credential, timePressure, accountThreat, payment, fakeDomainWords].filter(Boolean).length;
  const high = hasExternal && (credential || accountThreat || timePressure) && suspiciousScore >= 3;
  const minimumMedium = hasExternal || high;

  return { minimumMedium, high, externalLinks, suspiciousScore, credential, timePressure, accountThreat, payment, fakeDomainWords };
}

function sbImpersonationTextsPatchV1(lang, institutionName) {
  const name = institutionName || "instytucję";
  const map = {
    PL: {
      label: "Wysokie ryzyko podszywania się pod instytucję",
      summary: `Rozpoznano ${name}, ale wiadomość zawiera link, który nie wygląda jak oficjalna domena tej instytucji. To silny sygnał ostrzegawczy.`,
      signal: "Rozpoznano instytucję, ale link prowadzi poza oficjalną domenę",
      step1: "Nie klikaj linku z wiadomości.",
      step2: "Wejdź ręcznie na oficjalną stronę instytucji.",
      step3: "Nie podawaj loginu, hasła, kodu SMS ani danych bankowych."
    },
    EN: {
      label: "High institution impersonation risk",
      summary: `${name} was recognized, but the message contains a link that does not look like the official domain of this institution. This is a strong warning sign.`,
      signal: "The institution was recognized, but the link leads outside the official domain",
      step1: "Do not click the link in the message.",
      step2: "Open the official website of the institution manually.",
      step3: "Do not share login, password, SMS code or banking details."
    },
    NL: {
      label: "Hoog risico op imitatie van een officiële instantie",
      summary: `${name} is herkend, maar het bericht bevat een link die niet lijkt op het officiële domein van deze instantie. Dit is een sterk waarschuwingssignaal.`,
      signal: "De instantie is herkend, maar de link leidt buiten het officiële domein",
      step1: "Klik niet op de link in het bericht.",
      step2: "Open de officiële website van de instantie handmatig.",
      step3: "Deel geen login, wachtwoord, sms-code of bankgegevens."
    },
    DE: {
      label: "Hohes Risiko der Nachahmung einer Institution",
      summary: `${name} wurde erkannt, aber die Nachricht enthält einen Link, der nicht wie die offizielle Domain dieser Institution aussieht. Das ist ein starkes Warnsignal.`,
      signal: "Die Institution wurde erkannt, aber der Link führt außerhalb der offiziellen Domain",
      step1: "Klicken Sie nicht auf den Link in der Nachricht.",
      step2: "Öffnen Sie die offizielle Website der Institution manuell.",
      step3: "Geben Sie keine Login-, Passwort-, SMS-Code- oder Bankdaten weiter."
    },
    FR: {
      label: "Risque élevé d’usurpation d’institution",
      summary: `${name} a été reconnue, mais le message contient un lien qui ne semble pas appartenir au domaine officiel de cette institution. C’est un signal d’alerte fort.`,
      signal: "L’institution a été reconnue, mais le lien mène en dehors du domaine officiel",
      step1: "Ne cliquez pas sur le lien du message.",
      step2: "Ouvrez manuellement le site officiel de l’institution.",
      step3: "Ne partagez pas vos identifiants, mots de passe, codes SMS ou données bancaires."
    },
    IT: {
      label: "Alto rischio di impersonificazione dell’istituzione",
      summary: `${name} è stata riconosciuta, ma il messaggio contiene un link che non sembra appartenere al dominio ufficiale dell’istituzione. È un forte segnale di allarme.`,
      signal: "L’istituzione è stata riconosciuta, ma il link porta fuori dal dominio ufficiale",
      step1: "Non cliccare sul link nel messaggio.",
      step2: "Apri manualmente il sito ufficiale dell’istituzione.",
      step3: "Non condividere login, password, codice SMS o dati bancari."
    },
    ES: {
      label: "Alto riesgo de suplantación de institución",
      summary: `Se reconoció ${name}, pero el mensaje contiene un enlace que no parece pertenecer al dominio oficial de esta institución. Es una señal de alerta fuerte.`,
      signal: "Se reconoció la institución, pero el enlace lleva fuera del dominio oficial",
      step1: "No hagas clic en el enlace del mensaje.",
      step2: "Abre manualmente el sitio oficial de la institución.",
      step3: "No compartas usuario, contraseña, código SMS ni datos bancarios."
    },
    PT: {
      label: "Alto risco de falsificação de instituição",
      summary: `${name} foi reconhecida, mas a mensagem contém um link que não parece pertencer ao domínio oficial desta instituição. Isto é um forte sinal de alerta.`,
      signal: "A instituição foi reconhecida, mas o link leva para fora do domínio oficial",
      step1: "Não clique no link da mensagem.",
      step2: "Abra manualmente o site oficial da instituição.",
      step3: "Não partilhe login, palavra-passe, código SMS ou dados bancários."
    },
    UA: {
      label: "Високий ризик підробки установи",
      summary: `${name} розпізнано, але повідомлення містить посилання, яке не схоже на офіційний домен цієї установи. Це сильний сигнал небезпеки.`,
      signal: "Установу розпізнано, але посилання веде поза офіційним доменом",
      step1: "Не натискайте посилання в повідомленні.",
      step2: "Відкрийте офіційний сайт установи вручну.",
      step3: "Не передавайте логін, пароль, SMS-код або банківські дані."
    }
  };
  const L = (lang || "PL").toUpperCase();
  return map[L] || map.PL;
}

function sbApplyInstitutionImpersonationPatchV1(ctx) {
  if (!ctx || !ctx.fraudRisk) return ctx;
  const imp = sbDetectInstitutionImpersonationPatchV1(ctx.text, ctx.detectedLinks, ctx.institution);
  if (!imp.minimumMedium) return ctx;

  const institutionName = ctx.institution && ctx.institution.name ? ctx.institution.name : "institution";
  const labels = sbImpersonationTextsPatchV1(ctx.userLang, institutionName);

  if (imp.high) {
    ctx.fraudRisk.level = "HIGH";
    ctx.fraudRisk.confidence = Math.max(Number(ctx.fraudRisk.confidence || 0), 88);
    ctx.fraudRisk.label = labels.label;
    ctx.fraudRisk.summary = labels.summary;
    if (ctx.urgency !== "HIGH") ctx.urgency = "HIGH";
  } else if (ctx.fraudRisk.level !== "HIGH") {
    ctx.fraudRisk.level = "MEDIUM";
    ctx.fraudRisk.confidence = Math.max(Number(ctx.fraudRisk.confidence || 0), 76);
    ctx.fraudRisk.label = ctx.fraudRisk.label || labels.label;
    ctx.fraudRisk.summary = ctx.fraudRisk.summary || labels.summary;
  }

  ctx.fraudRisk.signals = Array.from(new Set([
    ...(Array.isArray(ctx.fraudRisk.signals) ? ctx.fraudRisk.signals : []),
    labels.signal
  ])).slice(0, 8);

  ctx.fraudRisk.suspiciousElements = Array.from(new Set([
    ...(Array.isArray(ctx.fraudRisk.suspiciousElements) ? ctx.fraudRisk.suspiciousElements : []),
    ...imp.externalLinks,
    labels.signal
  ])).slice(0, 8);

  ctx.fraudRisk.safeSteps = Array.from(new Set([
    labels.step1,
    labels.step2,
    labels.step3,
    ...(Array.isArray(ctx.fraudRisk.safeSteps) ? ctx.fraudRisk.safeSteps : [])
  ])).slice(0, 8);

  if (Array.isArray(ctx.risks)) {
    ctx.risks = Array.from(new Set([labels.step1, labels.step2, labels.step3, ...ctx.risks])).slice(0, 8);
  }
  if (Array.isArray(ctx.help)) {
    ctx.help = Array.from(new Set([labels.step2, ...ctx.help])).slice(0, 8);
  }
  return ctx;
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
    if (sig.timePressure) extraSignals.push(labels.timePressure || sbLocalTextV1(userLang, "timePressureShort"));
    if (sig.suspiciousLink) extraSignals.push(labels.risk1);
    if (sig.accountThreat) extraSignals.push(labels.accountThreat || sbLocalTextV1(userLang, "accountThreatShort"));

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
    if (sig.timePressure) suspiciousExtra.push(labels.timePressure || sbLocalTextV1(userLang, "timePressureShort"));
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

/* ============================================================
   Sense Bridge LOCALIZED HARD-CODED TEXT FIX v1
   Keeps existing logic, only localizes local post-processing text.
   ============================================================ */

function sbLocalTextV1(lang, key, vars = {}) {
  const L = (lang || "PL").toUpperCase();
  const dict = {
    suspiciousDomainOrPhone: {
      PL: "Wykryto podejrzaną domenę lub numer telefonu.",
      EN: "A suspicious domain or phone number was detected.",
      NL: "Er is een verdacht domein of telefoonnummer gedetecteerd.",
      DE: "Eine verdächtige Domain oder Telefonnummer wurde erkannt.",
      FR: "Un domaine ou un numéro de téléphone suspect a été détecté.",
      IT: "È stato rilevato un dominio o numero di telefono sospetto.",
      ES: "Se detectó un dominio o número de teléfono sospechoso.",
      PT: "Foi detetado um domínio ou número de telefone suspeito.",
      UA: "Виявлено підозрілий домен або номер телефону."
    },
    officialInstitutionSoftRisk: {
      PL: "Nie wykryto typowych sygnałów phishingu. Dla pewności sprawdź sprawę przez oficjalną stronę {name}.",
      EN: "No typical phishing signals were detected. If unsure, verify through the official website of {name}.",
      NL: "Er zijn geen typische phishing-signalen gevonden. Controleer bij twijfel via de officiële website van {name}.",
      DE: "Es wurden keine typischen Phishing-Signale erkannt. Prüfen Sie bei Zweifel über die offizielle Website von {name}.",
      FR: "Aucun signal typique de phishing n’a été détecté. En cas de doute, vérifiez via le site officiel de {name}.",
      IT: "Non sono stati rilevati segnali tipici di phishing. In caso di dubbio, verifica tramite il sito ufficiale di {name}.",
      ES: "No se detectaron señales típicas de phishing. En caso de duda, verifica a través del sitio oficial de {name}.",
      PT: "Não foram detetados sinais típicos de phishing. Em caso de dúvida, verifique pelo site oficial de {name}.",
      UA: "Типових ознак фішингу не виявлено. Якщо є сумніви, перевірте через офіційний сайт {name}."
    },
    timePressureShort: {
      PL: "Presja czasu lub pilna weryfikacja.",
      EN: "Time pressure or urgent verification.",
      NL: "Tijdsdruk of dringende verificatie.",
      DE: "Zeitdruck oder dringende Verifizierung.",
      FR: "Pression temporelle ou vérification urgente.",
      IT: "Pressione temporale o verifica urgente.",
      ES: "Presión de tiempo o verificación urgente.",
      PT: "Pressão de tempo ou verificação urgente.",
      UA: "Тиск часу або термінова перевірка."
    },
    accountThreatShort: {
      PL: "Groźba blokady lub utraty dostępu.",
      EN: "Threat of account suspension or loss of access.",
      NL: "Dreiging van blokkade of verlies van toegang.",
      DE: "Drohung mit Sperrung oder Zugangsverlust.",
      FR: "Menace de blocage ou de perte d’accès.",
      IT: "Minaccia di blocco o perdita di accesso.",
      ES: "Amenaza de bloqueo o pérdida de acceso.",
      PT: "Ameaça de bloqueio ou perda de acesso.",
      UA: "Погроза блокування або втрати доступу."
    }
  };
  const row = dict[key] || {};
  let value = row[L] || row.EN || row.PL || "";
  Object.keys(vars || {}).forEach(k => {
    value = value.replace(new RegExp("\\{" + k + "\\}", "g"), String(vars[k] || ""));
  });
  return value;
}

function sbNormalizeLocalPostProcessLanguageV1(payload, userLang) {
  if (!payload || typeof payload !== "object") return payload;
  const L = (userLang || payload.userLang || "PL").toUpperCase();

  const replacements = [
    ["Presja czasu / time pressure / urgência.", sbLocalTextV1(L, "timePressureShort")],
    ["Presja czasu / pilna weryfikacja.", sbLocalTextV1(L, "timePressureShort")],
    ["Groźba blokady lub utraty dostępu / account suspension threat.", sbLocalTextV1(L, "accountThreatShort")],
    [sbLocalTextV1(userLang, "suspiciousDomainOrPhone"), sbLocalTextV1(L, "suspiciousDomainOrPhone")],
    ["Wykryto podejrzaną domenę lub numer telefonu.", sbLocalTextV1(L, "suspiciousDomainOrPhone")]
  ];

  function fixString(s) {
    let out = String(s || "");
    for (const [from, to] of replacements) {
      if (out === from) return to;
      out = out.replaceAll(from, to);
    }
    return out;
  }

  function fixArray(arrValue) {
    if (!Array.isArray(arrValue)) return arrValue;
    return arrValue.map(x => typeof x === "string" ? fixString(x) : x);
  }

  payload.risks = fixArray(payload.risks);
  payload.riskList = fixArray(payload.riskList);
  payload.riskChips = fixArray(payload.riskChips);
  payload.consequences = fixArray(payload.consequences);
  payload.help = fixArray(payload.help);
  payload.actions = fixArray(payload.actions);
  payload.nextSteps = fixArray(payload.nextSteps);

  if (payload.fraudRisk && typeof payload.fraudRisk === "object") {
    payload.fraudRisk.label = fixString(payload.fraudRisk.label);
    payload.fraudRisk.summary = fixString(payload.fraudRisk.summary);
    payload.fraudRisk.signals = fixArray(payload.fraudRisk.signals);
    payload.fraudRisk.suspiciousElements = fixArray(payload.fraudRisk.suspiciousElements);
    payload.fraudRisk.safeSteps = fixArray(payload.fraudRisk.safeSteps);
    payload.fraudRisk.disclaimer = fixString(payload.fraudRisk.disclaimer);
  }

  if (payload.scamRisk && payload.scamRisk === payload.fraudRisk) payload.scamRisk = payload.fraudRisk;
  if (payload.authenticityRisk && payload.authenticityRisk === payload.fraudRisk) payload.authenticityRisk = payload.fraudRisk;

  return payload;
}

/* ============================================================
   Sense Bridge FORCE USER LANGUAGE NORMALIZATION v2
   Output-only cleanup. Does not change fraud detection logic.
   ============================================================ */

function forceUserLanguageNormalizationV2(payload, userLang) {
  if (!payload || typeof payload !== "object") return payload;

  const L = String(userLang || payload.userLang || "PL").toUpperCase();

  const phraseBank = [
    {
      keys: ["urgent data confirmation", "richiesta urgente", "confirmación urgente", "confirmação urgente", "dringende bestätigung", "confirmation urgente", "pilne potwierdzenie", "dringende bevestiging"],
      values: {
        PL: "Pilna prośba o potwierdzenie danych dostępowych.",
        EN: "Urgent request to confirm access details.",
        NL: "Dringend verzoek om toegangsgegevens te bevestigen.",
        DE: "Dringende Aufforderung zur Bestätigung von Zugangsdaten.",
        FR: "Demande urgente de confirmation des données d’accès.",
        IT: "Richiesta urgente di conferma dei dati di accesso.",
        ES: "Solicitud urgente de confirmación de datos de acceso.",
        PT: "Pedido urgente de confirmação dos dados de acesso.",
        UA: "Терміновий запит на підтвердження даних доступу."
      }
    },
    {
      keys: ["link does not belong", "link che non appartiene", "enlace no pertenece", "lien qui n’appartient", "link gehört nicht", "link behoort niet", "link nie należy"],
      values: {
        PL: "Link nie należy do oficjalnej domeny instytucji.",
        EN: "The link does not belong to the official domain of the institution.",
        NL: "De link behoort niet tot het officiële domein van de instantie.",
        DE: "Der Link gehört nicht zur offiziellen Domain der Institution.",
        FR: "Le lien n’appartient pas au domaine officiel de l’institution.",
        IT: "Il link non appartiene al dominio ufficiale dell’istituzione.",
        ES: "El enlace no pertenece al dominio oficial de la institución.",
        PT: "O link não pertence ao domínio oficial da instituição.",
        UA: "Посилання не належить до офіційного домену установи."
      }
    },
    {
      keys: ["time pressure", "presja czasu", "pressione temporale", "presión de tiempo", "pressão de tempo", "pression temporelle", "zeitdruck", "tijdsdruk"],
      values: {
        PL: "Presja czasu lub pilna weryfikacja.",
        EN: "Time pressure or urgent verification.",
        NL: "Tijdsdruk of dringende verificatie.",
        DE: "Zeitdruck oder dringende Verifizierung.",
        FR: "Pression temporelle ou vérification urgente.",
        IT: "Pressione temporale o verifica urgente.",
        ES: "Presión de tiempo o verificación urgente.",
        PT: "Pressão de tempo ou verificação urgente.",
        UA: "Тиск часу або термінова перевірка."
      }
    },
    {
      keys: ["account suspension", "utrata dostępu", "blocco", "bloqueo", "blocage", "sperrung", "blokkade", "suspension"],
      values: {
        PL: "Groźba blokady lub utraty dostępu.",
        EN: "Threat of account suspension or loss of access.",
        NL: "Dreiging van blokkade of verlies van toegang.",
        DE: "Drohung mit Sperrung oder Zugangsverlust.",
        FR: "Menace de blocage ou de perte d’accès.",
        IT: "Minaccia di blocco o perdita di accesso.",
        ES: "Amenaza de bloqueo o pérdida de acceso.",
        PT: "Ameaça de bloqueio ou perda de acesso.",
        UA: "Погроза блокування або втрати доступу."
      }
    },
    {
      keys: ["do not click", "nie klikaj", "non cliccare", "no hagas clic", "não clique", "ne cliquez pas", "klicken sie nicht", "klik niet"],
      values: {
        PL: "Nie klikaj linku z wiadomości.",
        EN: "Do not click the link in the message.",
        NL: "Klik niet op de link in het bericht.",
        DE: "Klicken Sie nicht auf den Link in der Nachricht.",
        FR: "Ne cliquez pas sur le lien du message.",
        IT: "Non cliccare sul link nel messaggio.",
        ES: "No hagas clic en el enlace del mensaje.",
        PT: "Não clique no link da mensagem.",
        UA: "Не натискайте посилання в повідомленні."
      }
    },
    {
      keys: ["do not share login", "nie podawaj loginu", "non condividere login", "no compartas usuario", "não partilhe login", "ne partagez pas", "geben sie keinen login", "deel geen login"],
      values: {
        PL: "Nie podawaj loginu, hasła, kodu SMS ani TAN.",
        EN: "Do not share login, password, SMS code or TAN.",
        NL: "Deel geen login, wachtwoord, sms-code of TAN.",
        DE: "Geben Sie keinen Login, kein Passwort, keinen SMS-Code und keine TAN weiter.",
        FR: "Ne partagez pas votre identifiant, mot de passe, code SMS ou TAN.",
        IT: "Non condividere login, password, codice SMS o TAN.",
        ES: "No compartas usuario, contraseña, código SMS ni TAN.",
        PT: "Não partilhe login, palavra-passe, código SMS ou TAN.",
        UA: "Не передавайте логін, пароль, SMS-код або TAN."
      }
    },
    {
      keys: ["institution was recognized", "rozpoznano instytucję", "instantie is herkend", "institution wurde erkannt", "institution a été reconnue", "istituzione è stata riconosciuta", "se reconoció la institución", "instituição foi reconhecida"],
      values: {
        PL: "Rozpoznano instytucję, ale link prowadzi poza oficjalną domenę.",
        EN: "The institution was recognized, but the link leads outside the official domain.",
        NL: "De instantie is herkend, maar de link leidt buiten het officiële domein.",
        DE: "Die Institution wurde erkannt, aber der Link führt außerhalb der offiziellen Domain.",
        FR: "L’institution a été reconnue, mais le lien mène en dehors du domaine officiel.",
        IT: "L’istituzione è stata riconosciuta, ma il link porta fuori dal dominio ufficiale.",
        ES: "Se reconoció la institución, pero el enlace lleva fuera del dominio oficial.",
        PT: "A instituição foi reconhecida, mas o link leva para fora do domínio oficial.",
        UA: "Установу розпізнано, але посилання веде поза офіційний домен."
      }
    }
  ];

  function normalizePhrase(s) {
    if (typeof s !== "string") return s;
    const original = s.trim();
    const lower = original.toLowerCase();

    for (const item of phraseBank) {
      if (item.keys.some(k => lower.includes(k))) {
        const translated = item.values[L] || item.values.EN || original;
        if (/https?:\/\//i.test(original)) return original;
        return translated;
      }
    }

    return original;
  }

  function fixArray(value) {
    if (!Array.isArray(value)) return value;
    return value.map(x => typeof x === "string" ? normalizePhrase(x) : x);
  }

  payload.risks = fixArray(payload.risks);
  payload.riskList = fixArray(payload.riskList);
  payload.riskChips = fixArray(payload.riskChips);
  payload.consequences = fixArray(payload.consequences);
  payload.help = fixArray(payload.help);
  payload.actions = fixArray(payload.actions);
  payload.nextSteps = fixArray(payload.nextSteps);

  if (payload.fraudRisk && typeof payload.fraudRisk === "object") {
    payload.fraudRisk.signals = fixArray(payload.fraudRisk.signals);
    payload.fraudRisk.suspiciousElements = fixArray(payload.fraudRisk.suspiciousElements);
    payload.fraudRisk.safeSteps = fixArray(payload.fraudRisk.safeSteps);
    payload.fraudRisk.label = normalizePhrase(payload.fraudRisk.label);
    payload.fraudRisk.summary = normalizePhrase(payload.fraudRisk.summary);
  }

  payload.scamRisk = payload.fraudRisk || payload.scamRisk;
  payload.authenticityRisk = payload.fraudRisk || payload.authenticityRisk;

  return payload;
}


/* ============================================================
   Sense Bridge GLOBAL SCAM LAYER v1
   Extra scam overlay for couriers, marketplaces, PayPal/Revolut/Wise,
   crypto and QR scams. It only raises clear scam cases; it does not
   weaken official institution logic.
   ============================================================ */

function sbApplyGlobalScamLayerV1(ctx) {
  if (!ctx || !ctx.fraudRisk) return ctx;

  const detection = sbDetectGlobalScamLayerV1(ctx.text, ctx.detectedLinks, ctx.suspiciousLinks);
  if (!detection || detection.score < 2) return ctx;

  const labels = sbGlobalScamTextsV1(ctx.userLang, detection.categoryLabel);
  const currentLevel = String(ctx.fraudRisk.level || "UNKNOWN").toUpperCase();

  const shouldHigh = detection.high || detection.score >= 5;
  const shouldMedium = detection.medium || detection.score >= 3;

  if (shouldHigh) {
    ctx.fraudRisk.level = "HIGH";
    ctx.fraudRisk.confidence = Math.max(Number(ctx.fraudRisk.confidence || 0), detection.confidenceHigh);
    ctx.fraudRisk.label = labels.highLabel;
    ctx.fraudRisk.summary = labels.highSummary;
    ctx.urgency = "HIGH";
  } else if (shouldMedium && currentLevel !== "HIGH") {
    ctx.fraudRisk.level = "MEDIUM";
    ctx.fraudRisk.confidence = Math.max(Number(ctx.fraudRisk.confidence || 0), detection.confidenceMedium);
    ctx.fraudRisk.label = ctx.fraudRisk.label || labels.mediumLabel;
    ctx.fraudRisk.summary = ctx.fraudRisk.summary || labels.mediumSummary;
    if (!ctx.urgency || ctx.urgency === "UNKNOWN" || ctx.urgency === "LOW") ctx.urgency = "MEDIUM";
  } else {
    return ctx;
  }

  ctx.fraudRisk.signals = Array.from(new Set([
    ...(Array.isArray(ctx.fraudRisk.signals) ? ctx.fraudRisk.signals : []),
    ...detection.signals.map(k => labels.signals[k] || k)
  ])).slice(0, 10);

  const suspiciousElements = [
    ...detection.links,
    ...detection.suspiciousDomains,
    ...detection.rawHits.map(x => labels.rawHitPrefix + ((labels.rawHits && labels.rawHits[x]) ? labels.rawHits[x] : x))
  ].filter(Boolean);

  ctx.fraudRisk.suspiciousElements = Array.from(new Set([
    ...(Array.isArray(ctx.fraudRisk.suspiciousElements) ? ctx.fraudRisk.suspiciousElements : []),
    ...suspiciousElements
  ])).slice(0, 10);

  ctx.fraudRisk.safeSteps = Array.from(new Set([
    labels.step1,
    labels.step2,
    labels.step3,
    labels.step4,
    ...(Array.isArray(ctx.fraudRisk.safeSteps) ? ctx.fraudRisk.safeSteps : [])
  ])).slice(0, 10);

  if (Array.isArray(ctx.risks)) {
    ctx.risks = Array.from(new Set([
      labels.risk1,
      labels.risk2,
      labels.risk3,
      ...ctx.risks
    ])).slice(0, 10);
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
      labels.help1,
      labels.help2,
      ...ctx.help
    ])).slice(0, 8);
  }

  // Scam/phishing is usually not a legal-help emergency by itself.
  if (ctx.legalHelpFinal === "URGENT" && !/court|rechtbank|sąd|komornik|deurwaarder|debt|incasso|egzekuc|deport/i.test(String(ctx.text || ""))) {
    ctx.legalHelpFinal = "RECOMMENDED";
  }

  return ctx;
}

function sbDetectGlobalScamLayerV1(text, detectedLinks, suspiciousLinks) {
  const t = String(text || "").toLowerCase();
  const links = Array.from(new Set([
    ...(Array.isArray(detectedLinks) ? detectedLinks : []),
    ...(Array.isArray(suspiciousLinks) ? suspiciousLinks : []),
    ...(typeof sbExtractLinksFromTextPatchV1 === "function" ? sbExtractLinksFromTextPatchV1(text) : [])
  ].map(x => String(x || "").trim()).filter(Boolean)));

  const hosts = links.map(sbHostFromGlobalScamV1).filter(Boolean);
  const joinedHosts = hosts.join(" ");

  const courierBrands = /(\bdhl\b|\bups\b|\bdpd\b|\bgls\b|\bfedex\b|\binpost\b|postnl|hermes|mondial\s*relay|colissimo|bpost|royal\s*mail|evri|correos|ctt|poste\s*italiane|packeta|paczkomat)/i;
  const marketplaceBrands = /(facebook\s*marketplace|marktplaats|\bolx\b|vinted|\bebay\b|gumtree|leboncoin|subito|kleinanzeigen|2dehands|wallapop|etsy|airbnb|booking\.com)/i;
  const paymentBrands = /(paypal|revolut|wise|payoneer|klarna|tikkie|ideal|bancontact|mb\s*way|skrill|western\s*union|moneygram)/i;
  const cryptoBrands = /(bitcoin|\bbtc\b|ethereum|\beth\b|crypto|krypto|wallet|seed\s*phrase|recovery\s*phrase|metamask|binance|coinbase|trust\s*wallet|usdt|tether|blockchain)/i;
  const qrWords = /(qr\s*code|qr-code|qr code|kod\s*qr|qr-kod|scan\s*(deze|this|ten)?\s*qr|scan.*qr|zeskanuj.*qr|escanea.*qr|scansiona.*qr|scannez.*qr)/i;

  const courierContext = courierBrands.test(t);
  const marketplaceContext = marketplaceBrands.test(t);
  const paymentContext = paymentBrands.test(t);
  const cryptoContext = cryptoBrands.test(t);
  const qrContext = qrWords.test(t);

  if (!courierContext && !marketplaceContext && !paymentContext && !cryptoContext && !qrContext) {
    return { score:0, high:false, medium:false, links:[], suspiciousDomains:[], signals:[], rawHits:[], categoryLabel:"" };
  }

  const loginSignal = /(login|log\s*in|inloggen|wachtwoord|password|passwort|hasło|contraseñ|senha|palavra[-\s]?passe|sms\s*code|tan|2fa|verification\s*code|verificatiecode|kod\s*sms|c[oó]digo)/i.test(t);
  const paymentSignal = /(pay|payment|betaling|betaal|betalen|płatno|zapłać|overmaken|iban|bankrekening|rekeningnummer|fee|kosten|douane|customs|import\s*fee|verzendkosten|delivery\s*fee|shipping\s*fee|verzeker|insurance)/i.test(t);
  const urgencySignal = /(urgent|dringend|pilne|natychmiast|immediately|direct|onmiddellijk|laatste\s*kans|last\s*chance|binnen\s*24\s*uur|within\s*24\s*hours|24\s*h|vandaag|today|heute|oggi|hoy)/i.test(t);
  const offPlatformSignal = /(whatsapp|telegram|signal|outside\s*(the\s*)?platform|buiten\s*(het\s*)?platform|poza\s*platform|hors\s*plateforme|fuera\s*de\s*la\s*plataforma|prywatny\s*kurier|private\s*courier)/i.test(t);
  const overpaySignal = /(overpayment|overpaid|teveel\s*betaald|za\s*dużo\s*zapłac|refund|terugbetaling|zwrot|remboursement|rimborso|reembolso|buyer\s*protection|kopersbescherming|seller\s*protection)/i.test(t);
  const cryptoSeedSignal = /(seed\s*phrase|recovery\s*phrase|private\s*key|secret\s*key|mnemonic|phrase\s*de\s*récupération|frase\s*secreta|klucz\s*prywatny)/i.test(t);
  const fakePrizeSignal = /(lottery|prize|winning|won\s+€|wygrałeś|prijs|gewonnen|premio|cadeaukaart|gift\s*card)/i.test(t);

  const suspiciousDomainWords = /(track|tracking|parcel|delivery|secure|verify|verification|login|account|payment|pay|wallet|support|claim|confirm|update|release|buyer|seller|escrow|protect|qr)/i;
  const officialBrandHosts = sbGlobalScamOfficialHostsV1();

  const suspiciousDomains = hosts.filter(host => {
    const officialMatch = officialBrandHosts.some(official => host === official || host.endsWith("." + official));
    if (officialMatch) return false;
    const hasBrandInHost = /(dhl|ups|dpd|gls|fedex|inpost|postnl|paypal|revolut|wise|marktplaats|olx|vinted|ebay|facebook|binance|coinbase|metamask)/i.test(host);
    const hasSuspiciousWords = suspiciousDomainWords.test(host);
    const shortener = /(^|\.)(bit\.ly|tinyurl\.com|t\.co|cutt\.ly|rebrand\.ly|is\.gd|ow\.ly|shorturl\.at|lnkd\.in)$/i.test(host);
    return hasBrandInHost || hasSuspiciousWords || shortener;
  });

  const rawHits = [];
  if (courierContext) rawHits.push("courier");
  if (marketplaceContext) rawHits.push("marketplace");
  if (paymentContext) rawHits.push("payment");
  if (cryptoContext) rawHits.push("crypto");
  if (qrContext) rawHits.push("qr");

  const signals = [];
  let score = 0;

  function add(cond, points, key) {
    if (!cond) return;
    score += points;
    if (key) signals.push(key);
  }

  add(courierContext || marketplaceContext || paymentContext || cryptoContext || qrContext, 1, "knownScamContext");
  add(suspiciousDomains.length > 0, 2, "suspiciousDomain");
  add(loginSignal, 2, "loginOrCodeRequest");
  add(paymentSignal, 2, "paymentRequest");
  add(urgencySignal, 1, "timePressure");
  add(offPlatformSignal, 2, "offPlatformContact");
  add(overpaySignal, 2, "refundOrOverpayment");
  add(cryptoSeedSignal, 4, "seedPhraseRequest");
  add(fakePrizeSignal, 2, "prizeOrGiftCard");
  add(qrContext && (paymentSignal || loginSignal), 2, "qrPaymentOrLogin");

  const high =
    cryptoSeedSignal ||
    (score >= 6) ||
    ((courierContext || marketplaceContext || paymentContext) && suspiciousDomains.length > 0 && (loginSignal || paymentSignal || urgencySignal)) ||
    (qrContext && (paymentSignal || loginSignal) && (suspiciousDomains.length > 0 || urgencySignal));

  const medium = score >= 3 || suspiciousDomains.length > 0 || (qrContext && (paymentSignal || loginSignal));

  let categoryLabel = "online scam";
  if (courierContext) categoryLabel = "courier scam";
  if (marketplaceContext) categoryLabel = "marketplace scam";
  if (paymentContext) categoryLabel = "payment scam";
  if (cryptoContext) categoryLabel = "crypto scam";
  if (qrContext) categoryLabel = "QR scam";

  return {
    score,
    high,
    medium,
    confidenceHigh: Math.min(94, 82 + Math.min(12, score * 2)),
    confidenceMedium: Math.min(84, 68 + Math.min(14, score * 2)),
    links,
    suspiciousDomains,
    signals: Array.from(new Set(signals)),
    rawHits: Array.from(new Set(rawHits)),
    categoryLabel
  };
}

function sbHostFromGlobalScamV1(link) {
  try {
    let raw = String(link || "").trim();
    if (!raw) return "";
    if (!/^https?:\/\//i.test(raw)) raw = "https://" + raw;
    return new URL(raw).hostname.replace(/^www\./i, "").toLowerCase();
  } catch {
    return "";
  }
}

function sbGlobalScamOfficialHostsV1() {
  return [
    "dhl.com", "dhl.de", "dpd.com", "dpd.nl", "gls-group.eu", "gls-netherlands.com",
    "ups.com", "fedex.com", "inpost.pl", "inpost.nl", "postnl.nl", "hermesworld.com",
    "paypal.com", "revolut.com", "wise.com", "klarna.com", "tikkie.me", "ideal.nl",
    "facebook.com", "marktplaats.nl", "olx.pl", "olx.ua", "vinted.nl", "vinted.pl", "vinted.com",
    "ebay.com", "ebay.nl", "ebay.de", "coinbase.com", "binance.com", "metamask.io"
  ];
}

function sbGlobalScamTextsV1(lang, categoryLabel) {
  const L = String(lang || "PL").toUpperCase();

  const categoryMap = {
    PL: {
      "courier scam": "oszustwa kurierskiego",
      "marketplace scam": "oszustwa na platformie sprzedażowej",
      "payment scam": "oszustwa płatniczego",
      "crypto scam": "oszustwa kryptowalutowego",
      "QR scam": "oszustwa przez kod QR",
      "online scam": "oszustwa internetowego"
    },
    EN: {
      "courier scam": "courier scam",
      "marketplace scam": "marketplace scam",
      "payment scam": "payment scam",
      "crypto scam": "crypto scam",
      "QR scam": "QR scam",
      "online scam": "online scam"
    },
    NL: {
      "courier scam": "pakketbezorgingsfraude",
      "marketplace scam": "marktplaatsfraude",
      "payment scam": "betaalfraude",
      "crypto scam": "cryptofraude",
      "QR scam": "QR-codefraude",
      "online scam": "online fraude"
    },
    DE: {
      "courier scam": "Paketdienst-Betrug",
      "marketplace scam": "Marktplatz-Betrug",
      "payment scam": "Zahlungsbetrug",
      "crypto scam": "Krypto-Betrug",
      "QR scam": "QR-Code-Betrug",
      "online scam": "Online-Betrug"
    },
    FR: {
      "courier scam": "arnaque au colis",
      "marketplace scam": "arnaque sur plateforme de vente",
      "payment scam": "arnaque au paiement",
      "crypto scam": "arnaque aux cryptomonnaies",
      "QR scam": "arnaque au QR code",
      "online scam": "arnaque en ligne"
    },
    IT: {
      "courier scam": "truffa di consegna pacchi",
      "marketplace scam": "truffa su piattaforma di vendita",
      "payment scam": "truffa di pagamento",
      "crypto scam": "truffa crypto",
      "QR scam": "truffa tramite codice QR",
      "online scam": "truffa online"
    },
    ES: {
      "courier scam": "estafa de paquetería",
      "marketplace scam": "estafa en plataforma de compraventa",
      "payment scam": "estafa de pago",
      "crypto scam": "estafa con criptomonedas",
      "QR scam": "estafa mediante código QR",
      "online scam": "estafa online"
    },
    PT: {
      "courier scam": "burla de encomendas",
      "marketplace scam": "burla em plataforma de compra e venda",
      "payment scam": "burla de pagamento",
      "crypto scam": "burla com criptomoedas",
      "QR scam": "burla por código QR",
      "online scam": "burla online"
    },
    UA: {
      "courier scam": "шахрайство з доставкою",
      "marketplace scam": "шахрайство на торговельній платформі",
      "payment scam": "платіжне шахрайство",
      "crypto scam": "криптошахрайство",
      "QR scam": "шахрайство через QR-код",
      "online scam": "онлайн-шахрайство"
    }
  };

  const cat = (categoryMap[L] || categoryMap.PL)[categoryLabel] || (categoryMap[L] || categoryMap.PL)["online scam"];

  const signalMaps = {
    PL: {
      knownScamContext: "Rozpoznano kontekst częsty w oszustwach online.",
      suspiciousDomain: "Link lub domena wygląda nietypowo.",
      loginOrCodeRequest: "Wiadomość prosi o login, hasło albo kod weryfikacyjny.",
      paymentRequest: "Wiadomość prosi o płatność lub dane płatnicze.",
      timePressure: "Wiadomość używa presji czasu.",
      offPlatformContact: "Wiadomość sugeruje kontakt lub płatność poza platformą.",
      refundOrOverpayment: "Pojawia się motyw zwrotu, nadpłaty albo ochrony kupującego.",
      seedPhraseRequest: "Prośba o seed phrase / private key to bardzo silny sygnał oszustwa.",
      prizeOrGiftCard: "Pojawia się motyw nagrody, wygranej albo karty podarunkowej.",
      qrPaymentOrLogin: "Kod QR jest połączony z płatnością lub logowaniem."
    },
    EN: {
      knownScamContext: "A context often used in online scams was detected.",
      suspiciousDomain: "The link or domain looks unusual.",
      loginOrCodeRequest: "The message asks for a login, password or verification code.",
      paymentRequest: "The message asks for payment or payment details.",
      timePressure: "The message uses time pressure.",
      offPlatformContact: "The message suggests contact or payment outside the platform.",
      refundOrOverpayment: "It mentions a refund, overpayment or buyer protection.",
      seedPhraseRequest: "A request for a seed phrase / private key is a very strong scam signal.",
      prizeOrGiftCard: "It mentions a prize, winnings or a gift card.",
      qrPaymentOrLogin: "The QR code is connected with payment or login."
    },
    NL: {
      knownScamContext: "Er is een context herkend die vaak bij online fraude voorkomt.",
      suspiciousDomain: "De link of domeinnaam ziet er ongebruikelijk uit.",
      loginOrCodeRequest: "Het bericht vraagt om login, wachtwoord of verificatiecode.",
      paymentRequest: "Het bericht vraagt om betaling of betaalgegevens.",
      timePressure: "Het bericht gebruikt tijdsdruk.",
      offPlatformContact: "Het bericht stelt contact of betaling buiten het platform voor.",
      refundOrOverpayment: "Er is sprake van terugbetaling, te veel betaald bedrag of kopersbescherming.",
      seedPhraseRequest: "Een verzoek om seed phrase / private key is een zeer sterk fraudesignaal.",
      prizeOrGiftCard: "Er is sprake van een prijs, gewonnen bedrag of cadeaubon.",
      qrPaymentOrLogin: "De QR-code is gekoppeld aan betaling of inloggen."
    },
    DE: {
      knownScamContext: "Ein Kontext, der häufig bei Online-Betrug vorkommt, wurde erkannt.",
      suspiciousDomain: "Der Link oder die Domain wirkt ungewöhnlich.",
      loginOrCodeRequest: "Die Nachricht fragt nach Login, Passwort oder Bestätigungscode.",
      paymentRequest: "Die Nachricht fordert eine Zahlung oder Zahlungsdaten an.",
      timePressure: "Die Nachricht nutzt Zeitdruck.",
      offPlatformContact: "Die Nachricht schlägt Kontakt oder Zahlung außerhalb der Plattform vor.",
      refundOrOverpayment: "Es geht um Rückerstattung, Überzahlung oder Käuferschutz.",
      seedPhraseRequest: "Eine Anfrage nach Seed Phrase / Private Key ist ein sehr starkes Betrugssignal.",
      prizeOrGiftCard: "Es wird ein Gewinn, Preis oder eine Geschenkkarte erwähnt.",
      qrPaymentOrLogin: "Der QR-Code ist mit Zahlung oder Login verbunden."
    },
    FR: {
      knownScamContext: "Un contexte souvent utilisé dans les arnaques en ligne a été détecté.",
      suspiciousDomain: "Le lien ou le domaine semble inhabituel.",
      loginOrCodeRequest: "Le message demande un identifiant, un mot de passe ou un code de vérification.",
      paymentRequest: "Le message demande un paiement ou des données de paiement.",
      timePressure: "Le message utilise une pression temporelle.",
      offPlatformContact: "Le message suggère un contact ou un paiement hors plateforme.",
      refundOrOverpayment: "Il mentionne un remboursement, un trop-payé ou une protection acheteur.",
      seedPhraseRequest: "Une demande de seed phrase / clé privée est un signal d’arnaque très fort.",
      prizeOrGiftCard: "Il mentionne un prix, un gain ou une carte cadeau.",
      qrPaymentOrLogin: "Le code QR est lié à un paiement ou à une connexion."
    },
    IT: {
      knownScamContext: "È stato rilevato un contesto spesso usato nelle truffe online.",
      suspiciousDomain: "Il link o il dominio sembra insolito.",
      loginOrCodeRequest: "Il messaggio chiede login, password o codice di verifica.",
      paymentRequest: "Il messaggio chiede un pagamento o dati di pagamento.",
      timePressure: "Il messaggio usa pressione temporale.",
      offPlatformContact: "Il messaggio suggerisce contatto o pagamento fuori dalla piattaforma.",
      refundOrOverpayment: "Compare un rimborso, un pagamento eccessivo o protezione acquirente.",
      seedPhraseRequest: "Una richiesta di seed phrase / private key è un segnale di truffa molto forte.",
      prizeOrGiftCard: "Compare un premio, una vincita o una carta regalo.",
      qrPaymentOrLogin: "Il codice QR è collegato a pagamento o login."
    },
    ES: {
      knownScamContext: "Se detectó un contexto usado a menudo en estafas online.",
      suspiciousDomain: "El enlace o dominio parece inusual.",
      loginOrCodeRequest: "El mensaje pide usuario, contraseña o código de verificación.",
      paymentRequest: "El mensaje pide un pago o datos de pago.",
      timePressure: "El mensaje usa presión de tiempo.",
      offPlatformContact: "El mensaje sugiere contacto o pago fuera de la plataforma.",
      refundOrOverpayment: "Aparece un motivo de reembolso, sobrepago o protección del comprador.",
      seedPhraseRequest: "Una solicitud de seed phrase / clave privada es una señal muy fuerte de estafa.",
      prizeOrGiftCard: "Aparece un premio, ganancia o tarjeta regalo.",
      qrPaymentOrLogin: "El código QR está conectado con pago o inicio de sesión."
    },
    PT: {
      knownScamContext: "Foi detetado um contexto frequentemente usado em burlas online.",
      suspiciousDomain: "O link ou domínio parece invulgar.",
      loginOrCodeRequest: "A mensagem pede login, palavra-passe ou código de verificação.",
      paymentRequest: "A mensagem pede pagamento ou dados de pagamento.",
      timePressure: "A mensagem usa pressão de tempo.",
      offPlatformContact: "A mensagem sugere contacto ou pagamento fora da plataforma.",
      refundOrOverpayment: "Aparece um motivo de reembolso, pagamento em excesso ou proteção do comprador.",
      seedPhraseRequest: "Um pedido de seed phrase / chave privada é um sinal muito forte de burla.",
      prizeOrGiftCard: "Aparece um prémio, ganho ou cartão oferta.",
      qrPaymentOrLogin: "O código QR está ligado a pagamento ou login."
    },
    UA: {
      knownScamContext: "Виявлено контекст, який часто використовується в онлайн-шахрайстві.",
      suspiciousDomain: "Посилання або домен виглядає незвично.",
      loginOrCodeRequest: "Повідомлення просить логін, пароль або код підтвердження.",
      paymentRequest: "Повідомлення просить оплату або платіжні дані.",
      timePressure: "Повідомлення використовує тиск часу.",
      offPlatformContact: "Повідомлення пропонує контакт або оплату поза платформою.",
      refundOrOverpayment: "Згадується повернення коштів, переплата або захист покупця.",
      seedPhraseRequest: "Запит seed phrase / private key є дуже сильним сигналом шахрайства.",
      prizeOrGiftCard: "Згадується приз, виграш або подарункова картка.",
      qrPaymentOrLogin: "QR-код пов’язаний з оплатою або входом."
    }
  };

  const map = {
    PL: {
      highLabel: "Wysokie ryzyko oszustwa internetowego",
      mediumLabel: "Warto zweryfikować wiadomość",
      highSummary: `Wiadomość zawiera sygnały typowe dla ${cat}: link, płatność, logowanie, kod, presję czasu lub kontakt poza oficjalnym kanałem. Nie da się potwierdzić autentyczności tylko z tekstu.`,
      mediumSummary: `Wiadomość przypomina schemat ${cat}. Warto sprawdzić ją przez oficjalną stronę lub aplikację, bez klikania linków z wiadomości.`,
      risk1: "Wiadomość może prowadzić do fałszywej płatności lub przejęcia danych.",
      risk2: "Link, kod QR albo kontakt poza platformą wymaga dodatkowej weryfikacji.",
      risk3: "Presja czasu może być elementem manipulacji.",
      consequence1: "Kliknięcie linku może prowadzić do utraty danych logowania lub pieniędzy.",
      consequence2: "Podanie kodu SMS, hasła lub danych karty może umożliwić przejęcie konta.",
      help1: "Sprawdź sprawę ręcznie w oficjalnej aplikacji lub na oficjalnej stronie.",
      help2: "W razie płatności sprawdź transakcję w banku lub u operatora platformy.",
      step1: "Nie klikaj linku ani kodu QR z wiadomości.",
      step2: "Nie podawaj loginu, hasła, kodu SMS/TAN, danych karty ani seed phrase.",
      step3: "Otwórz ręcznie oficjalną aplikację lub stronę usługi.",
      step4: "Przy sprzedaży/kupnie nie przenoś rozmowy i płatności poza platformę.",
      rawHitPrefix: "Kontekst: "
    },
    EN: {
      highLabel: "High online scam risk",
      mediumLabel: "Verify this message",
      highSummary: `The message contains signals typical of a ${cat}: link, payment, login, code, time pressure or contact outside the official channel. Authenticity cannot be confirmed from text alone.`,
      mediumSummary: `The message resembles a ${cat} pattern. Verify it through the official website or app without using links from the message.`,
      risk1: "The message may lead to a fake payment or data theft.",
      risk2: "A link, QR code or off-platform contact needs extra verification.",
      risk3: "Time pressure may be used to manipulate you.",
      consequence1: "Clicking the link may lead to loss of login data or money.",
      consequence2: "Sharing an SMS code, password or card details may allow account takeover.",
      help1: "Check manually in the official app or on the official website.",
      help2: "For payments, check the transaction with your bank or platform provider.",
      step1: "Do not click the link or QR code from the message.",
      step2: "Do not share login, password, SMS/TAN code, card details or seed phrase.",
      step3: "Open the official app or service website manually.",
      step4: "When buying or selling, do not move chat and payment outside the platform.",
      rawHitPrefix: "Context: "
    },
    NL: {
      highLabel: "Hoog risico op online fraude",
      mediumLabel: "Controleer dit bericht",
      highSummary: `Het bericht bevat signalen die passen bij ${cat}: link, betaling, login, code, tijdsdruk of contact buiten het officiële kanaal. Echtheid kan niet alleen uit de tekst worden bevestigd.`,
      mediumSummary: `Het bericht lijkt op een patroon van ${cat}. Controleer dit via de officiële website of app, zonder links uit het bericht te gebruiken.`,
      risk1: "Het bericht kan leiden tot een valse betaling of diefstal van gegevens.",
      risk2: "Een link, QR-code of contact buiten het platform vereist extra controle.",
      risk3: "Tijdsdruk kan worden gebruikt als manipulatie.",
      consequence1: "Klikken op de link kan leiden tot verlies van inloggegevens of geld.",
      consequence2: "Het delen van een sms-code, wachtwoord of kaartgegevens kan accountovername mogelijk maken.",
      help1: "Controleer handmatig in de officiële app of op de officiële website.",
      help2: "Controleer bij betalingen de transactie bij uw bank of platform.",
      step1: "Klik niet op de link of QR-code uit het bericht.",
      step2: "Deel geen login, wachtwoord, sms/TAN-code, kaartgegevens of seed phrase.",
      step3: "Open de officiële app of website handmatig.",
      step4: "Verplaats bij kopen of verkopen chat en betaling niet buiten het platform.",
      rawHitPrefix: "Context: "
    },
    DE: {
      highLabel: "Hohes Risiko für Online-Betrug",
      mediumLabel: "Diese Nachricht prüfen",
      highSummary: `Die Nachricht enthält Signale, die zu ${cat} passen: Link, Zahlung, Login, Code, Zeitdruck oder Kontakt außerhalb des offiziellen Kanals. Die Echtheit kann nicht nur anhand des Textes bestätigt werden.`,
      mediumSummary: `Die Nachricht ähnelt einem Muster von ${cat}. Prüfen Sie sie über die offizielle Website oder App, ohne Links aus der Nachricht zu verwenden.`,
      risk1: "Die Nachricht kann zu einer falschen Zahlung oder Datendiebstahl führen.",
      risk2: "Ein Link, QR-Code oder Kontakt außerhalb der Plattform muss zusätzlich geprüft werden.",
      risk3: "Zeitdruck kann zur Manipulation genutzt werden.",
      consequence1: "Das Anklicken des Links kann zum Verlust von Zugangsdaten oder Geld führen.",
      consequence2: "Die Weitergabe von SMS-Code, Passwort oder Kartendaten kann eine Kontoübernahme ermöglichen.",
      help1: "Prüfen Sie manuell in der offiziellen App oder auf der offiziellen Website.",
      help2: "Bei Zahlungen prüfen Sie die Transaktion bei Ihrer Bank oder Plattform.",
      step1: "Klicken Sie nicht auf den Link oder QR-Code aus der Nachricht.",
      step2: "Geben Sie keinen Login, kein Passwort, keinen SMS/TAN-Code, keine Kartendaten und keine Seed Phrase weiter.",
      step3: "Öffnen Sie die offizielle App oder Website manuell.",
      step4: "Verlagern Sie beim Kaufen oder Verkaufen Chat und Zahlung nicht außerhalb der Plattform.",
      rawHitPrefix: "Kontext: "
    },
    FR: {
      highLabel: "Risque élevé d’arnaque en ligne",
      mediumLabel: "Vérifiez ce message",
      highSummary: `Le message contient des signaux typiques de ${cat} : lien, paiement, connexion, code, pression temporelle ou contact hors canal officiel. L’authenticité ne peut pas être confirmée uniquement à partir du texte.`,
      mediumSummary: `Le message ressemble à un schéma de ${cat}. Vérifiez via le site ou l’application officiels sans utiliser les liens du message.`,
      risk1: "Le message peut mener à un faux paiement ou au vol de données.",
      risk2: "Un lien, un code QR ou un contact hors plateforme nécessite une vérification supplémentaire.",
      risk3: "La pression temporelle peut être utilisée pour vous manipuler.",
      consequence1: "Cliquer sur le lien peut entraîner la perte d’identifiants ou d’argent.",
      consequence2: "Partager un code SMS, un mot de passe ou des données de carte peut permettre la prise de contrôle du compte.",
      help1: "Vérifiez manuellement dans l’application officielle ou sur le site officiel.",
      help2: "Pour les paiements, vérifiez la transaction auprès de votre banque ou de la plateforme.",
      step1: "Ne cliquez pas sur le lien ou le code QR du message.",
      step2: "Ne partagez pas vos identifiants, mot de passe, code SMS/TAN, données de carte ou seed phrase.",
      step3: "Ouvrez manuellement l’application ou le site officiel du service.",
      step4: "Lors d’un achat ou d’une vente, ne déplacez pas la conversation et le paiement hors plateforme.",
      rawHitPrefix: "Contexte : "
    },
    IT: {
      highLabel: "Alto rischio di truffa online",
      mediumLabel: "Verifica questo messaggio",
      highSummary: `Il messaggio contiene segnali tipici di ${cat}: link, pagamento, login, codice, pressione del tempo o contatto fuori dal canale ufficiale. L’autenticità non può essere confermata solo dal testo.`,
      mediumSummary: `Il messaggio somiglia a uno schema di ${cat}. Verificalo tramite il sito o l’app ufficiale senza usare i link del messaggio.`,
      risk1: "Il messaggio può portare a un pagamento falso o al furto di dati.",
      risk2: "Un link, codice QR o contatto fuori piattaforma richiede una verifica aggiuntiva.",
      risk3: "La pressione del tempo può essere usata per manipolarti.",
      consequence1: "Cliccare sul link può causare perdita di credenziali o denaro.",
      consequence2: "Condividere codice SMS, password o dati della carta può consentire il furto dell’account.",
      help1: "Controlla manualmente nell’app ufficiale o sul sito ufficiale.",
      help2: "Per i pagamenti, verifica la transazione con la banca o la piattaforma.",
      step1: "Non cliccare sul link o sul codice QR del messaggio.",
      step2: "Non condividere login, password, codice SMS/TAN, dati della carta o seed phrase.",
      step3: "Apri manualmente l’app o il sito ufficiale del servizio.",
      step4: "Quando compri o vendi, non spostare chat e pagamento fuori dalla piattaforma.",
      rawHitPrefix: "Contesto: "
    },
    ES: {
      highLabel: "Alto riesgo de estafa online",
      mediumLabel: "Verifica este mensaje",
      highSummary: `El mensaje contiene señales típicas de ${cat}: enlace, pago, inicio de sesión, código, presión de tiempo o contacto fuera del canal oficial. La autenticidad no se puede confirmar solo con el texto.`,
      mediumSummary: `El mensaje se parece a un patrón de ${cat}. Verifícalo a través del sitio o la app oficial sin usar enlaces del mensaje.`,
      risk1: "El mensaje puede llevar a un pago falso o robo de datos.",
      risk2: "Un enlace, código QR o contacto fuera de la plataforma requiere verificación adicional.",
      risk3: "La presión de tiempo puede usarse para manipularte.",
      consequence1: "Hacer clic en el enlace puede causar pérdida de datos de acceso o dinero.",
      consequence2: "Compartir código SMS, contraseña o datos de tarjeta puede permitir el robo de la cuenta.",
      help1: "Comprueba manualmente en la app oficial o en el sitio oficial.",
      help2: "Para pagos, verifica la transacción con tu banco o plataforma.",
      step1: "No hagas clic en el enlace ni en el código QR del mensaje.",
      step2: "No compartas usuario, contraseña, código SMS/TAN, datos de tarjeta ni seed phrase.",
      step3: "Abre manualmente la app o el sitio oficial del servicio.",
      step4: "Al comprar o vender, no muevas el chat ni el pago fuera de la plataforma.",
      rawHitPrefix: "Contexto: "
    },
    PT: {
      highLabel: "Alto risco de burla online",
      mediumLabel: "Verifique esta mensagem",
      highSummary: `A mensagem contém sinais típicos de ${cat}: link, pagamento, login, código, pressão de tempo ou contacto fora do canal oficial. A autenticidade não pode ser confirmada apenas pelo texto.`,
      mediumSummary: `A mensagem parece seguir um padrão de ${cat}. Verifique pelo site ou app oficial sem usar links da mensagem.`,
      risk1: "A mensagem pode levar a um pagamento falso ou roubo de dados.",
      risk2: "Um link, código QR ou contacto fora da plataforma exige verificação adicional.",
      risk3: "A pressão de tempo pode ser usada para manipulação.",
      consequence1: "Clicar no link pode levar à perda de dados de acesso ou dinheiro.",
      consequence2: "Partilhar código SMS, palavra-passe ou dados do cartão pode permitir roubo da conta.",
      help1: "Verifique manualmente na app oficial ou no site oficial.",
      help2: "Em pagamentos, confirme a transação com o banco ou a plataforma.",
      step1: "Não clique no link ou código QR da mensagem.",
      step2: "Não partilhe login, palavra-passe, código SMS/TAN, dados do cartão ou seed phrase.",
      step3: "Abra manualmente a app ou site oficial do serviço.",
      step4: "Ao comprar ou vender, não leve a conversa e o pagamento para fora da plataforma.",
      rawHitPrefix: "Contexto: "
    },
    UA: {
      highLabel: "Високий ризик онлайн-шахрайства",
      mediumLabel: "Перевірте це повідомлення",
      highSummary: `Повідомлення містить ознаки, типові для ${cat}: посилання, платіж, логін, код, тиск часу або контакт поза офіційним каналом. Автентичність неможливо підтвердити лише з тексту.`,
      mediumSummary: `Повідомлення схоже на схему ${cat}. Перевірте його через офіційний сайт або додаток, не використовуючи посилання з повідомлення.`,
      risk1: "Повідомлення може вести до фальшивого платежу або крадіжки даних.",
      risk2: "Посилання, QR-код або контакт поза платформою потребує додаткової перевірки.",
      risk3: "Тиск часу може бути елементом маніпуляції.",
      consequence1: "Перехід за посиланням може призвести до втрати логіну або грошей.",
      consequence2: "Передача SMS-коду, пароля або даних картки може дозволити захоплення акаунта.",
      help1: "Перевірте вручну в офіційному додатку або на офіційному сайті.",
      help2: "Для платежів перевірте транзакцію в банку або на платформі.",
      step1: "Не натискайте посилання або QR-код із повідомлення.",
      step2: "Не передавайте логін, пароль, SMS/TAN-код, дані картки або seed phrase.",
      step3: "Відкрийте офіційний додаток або сайт вручну.",
      step4: "Під час купівлі чи продажу не переносіть чат і оплату поза платформою.",
      rawHitPrefix: "Контекст: "
    }
  };

  const rawHitTranslations = {
    PL: { courier: "kurier", marketplace: "platforma sprzedażowa", payment: "płatność", crypto: "krypto", qr: "kod QR" },
    EN: { courier: "courier", marketplace: "marketplace", payment: "payment", crypto: "crypto", qr: "QR code" },
    NL: { courier: "pakketbezorging", marketplace: "marktplaats/platform", payment: "betaling", crypto: "crypto", qr: "QR-code" },
    DE: { courier: "Paketdienst", marketplace: "Marktplatz", payment: "Zahlung", crypto: "Krypto", qr: "QR-Code" },
    FR: { courier: "livraison de colis", marketplace: "plateforme de vente", payment: "paiement", crypto: "crypto", qr: "code QR" },
    IT: { courier: "consegna pacchi", marketplace: "piattaforma di vendita", payment: "pagamento", crypto: "crypto", qr: "codice QR" },
    ES: { courier: "paquetería", marketplace: "plataforma de compraventa", payment: "pago", crypto: "cripto", qr: "código QR" },
    PT: { courier: "encomenda", marketplace: "plataforma de compra e venda", payment: "pagamento", crypto: "cripto", qr: "código QR" },
    UA: { courier: "доставка", marketplace: "торговельна платформа", payment: "платіж", crypto: "крипто", qr: "QR-код" }
  };

  const out = map[L] || map.PL;
  out.signals = signalMaps[L] || signalMaps.PL;
  out.rawHits = rawHitTranslations[L] || rawHitTranslations.PL;
  return out;
}


/* ============================================================
   Sense Bridge OUTPUT DEDUPE v1
   Output cleanup only. It removes repeated links/text from arrays
   after all detection and language-normalization layers are done.
   ============================================================ */

function sbDedupePayloadArraysV1(payload) {
  if (!payload || typeof payload !== "object") return payload;

  function cleanDisplayItem(value) {
    if (typeof value !== "string") return value;
    return String(value || "")
      // Remove replacement character and invisible Unicode artifacts often added by OCR/copy-paste.
      .replace(/[\uFFFD\u00AD\u034F\u061C\u115F\u1160\u17B4\u17B5\u180E\u200B\u200C\u200D\u200E\u200F\u202A-\u202E\u2060-\u206F\u3164\uFEFF]+/g, "")
      // Remove ASCII control characters.
      .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]+/g, "")
      .replace(/\s+/g, " ")
      .replace(/([\w\-\/])\s+([.,;:!?])/g, "$1$2")
      .replace(/[.,;:!?\])}]+$/g, "")
      .trim();
  }

  function normalizeItem(value) {
    let s = cleanDisplayItem(value);
    s = String(s || "").trim();
    if (!s) return "";

    // Normalize URLs so the same link is not shown twice only because
    // of OCR/AI artifacts, protocol, www, trailing slash, or punctuation.
    const urlMatch = s.match(/https?:\/\/[^\s<>()"']+|www\.[^\s<>()"']+|\b[a-z0-9][a-z0-9-]{1,}\.[a-z]{2,}(?:\/[^\s<>()"']*)?/i);
    if (urlMatch) {
      let raw = cleanDisplayItem(urlMatch[0])
        .replace(/[.,;:!?\])}]+$/g, "")
        .trim();
      try {
        if (!/^https?:\/\//i.test(raw)) raw = "https://" + raw;
        const u = new URL(raw);
        let host = u.hostname.replace(/^www\./i, "").toLowerCase();
        let path = u.pathname.replace(/\/+$/g, "");
        return "url:" + host + path + (u.search || "");
      } catch {
        return "url:" + raw.toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/\/+$/g, "");
      }
    }

    return "text:" + s
      .toLowerCase()
      .normalize("NFKC")
      .replace(/\s+/g, " ")
      .replace(/[.,;:!?]+$/g, "")
      .trim();
  }

  function dedupeArray(value) {
    if (!Array.isArray(value)) return value;
    const seen = new Set();
    const out = [];
    for (const item of value) {
      if (item === null || item === undefined) continue;
      const cleaned = cleanDisplayItem(item);
      const key = normalizeItem(cleaned);
      if (!key || seen.has(key)) continue;
      seen.add(key);
      out.push(cleaned);
    }
    return out;
  }

  const topArrays = [
    "detectedLinks",
    "suspiciousLinks",
    "suspiciousPhoneMatches",
    "detectedPhones",
    "risks",
    "riskList",
    "riskChips",
    "consequences",
    "help",
    "actions",
    "nextSteps"
  ];

  for (const key of topArrays) {
    payload[key] = dedupeArray(payload[key]);
  }

  if (payload.fraudRisk && typeof payload.fraudRisk === "object") {
    payload.fraudRisk.signals = dedupeArray(payload.fraudRisk.signals);
    payload.fraudRisk.suspiciousElements = dedupeArray(payload.fraudRisk.suspiciousElements);
    payload.fraudRisk.safeSteps = dedupeArray(payload.fraudRisk.safeSteps);
  }

  // Keep mirrored fields consistent for the UI.
  payload.riskList = Array.isArray(payload.risks) ? [...payload.risks] : payload.riskList;
  payload.riskChips = Array.isArray(payload.risks) ? [...payload.risks] : payload.riskChips;
  payload.scamRisk = payload.fraudRisk || payload.scamRisk;
  payload.authenticityRisk = payload.fraudRisk || payload.authenticityRisk;

  return payload;
}

/* ============================================================
   Sense Bridge GLOBAL IMPERSONATION HIGH GUARD v1
   Safety overlay only. It raises obvious global impersonation
   cases to HIGH; it does not weaken existing fraud logic.
   ============================================================ */

function sbApplyGlobalImpersonationHighGuardV1(ctx) {
  if (!ctx || !ctx.fraudRisk || !ctx.institution) return ctx;

  const institution = ctx.institution || {};
  const officialWebsite = String(institution.officialWebsite || "").trim();
  const confidence = Number(institution.confidence || 0);
  if (!officialWebsite || confidence < 70) return ctx;

  const text = String(ctx.text || "").toLowerCase();
  const linksFromModel = Array.isArray(ctx.detectedLinks) ? ctx.detectedLinks : [];
  const linksFromText = typeof sbExtractLinksFromTextPatchV1 === "function"
    ? sbExtractLinksFromTextPatchV1(ctx.text)
    : [];
  const allLinks = Array.from(new Set([...linksFromModel, ...linksFromText].filter(Boolean)));

  function hostFromUrl(url) {
    try {
      let raw = String(url || "").trim();
      if (!raw) return "";
      if (!/^https?:\/\//i.test(raw)) raw = "https://" + raw;
      return new URL(raw).hostname.replace(/^www\./i, "").toLowerCase();
    } catch {
      return "";
    }
  }

  const officialHost = hostFromUrl(officialWebsite);
  if (!officialHost) return ctx;

  const externalLinks = allLinks.filter(link => {
    const host = hostFromUrl(link);
    if (!host) return false;
    return !(host === officialHost || host.endsWith("." + officialHost));
  });

  if (!externalLinks.length) return ctx;

  const credentialSignal =
    /(tan|sms[\s-]*(code|kod|codigo|c[oó]digo|codice)|password|passwort|wachtwoord|hasło|contraseña|senha|palavra[-\s]?passe|login|usuario|utente|gebruiker|username|access code|c[oó]digo de acesso|dane dostępowe|zugangsdaten|credenciais|credenziali)/i.test(text);

  const urgentSignal =
    /((2|3|6|8|12|24)\s*(h|hours|hour|uur|stunden|ore|heures|horas|godzin)|within\s*(2|3|6|8|12|24)\s*hours|binnen\s*(2|3|6|8|12|24)\s*uur|dentro de\s*(2|3|6|8|12|24)\s*horas|entro\s*(2|3|6|8|12|24)\s*ore|dans un délai de\s*(2|3|6|8|12|24)\s*heures|urgent|urgente|dringend|sofort|natychmiast|onmiddellijk|immediately|imediatamente)/i.test(text);

  const accountThreatSignal =
    /(account|konto|rekening|cuenta|conta|compte|utente|expediente).{0,120}(suspend|suspended|suspenso|sospeso|gesperrt|blocked|bloquead|blok|zablok|deaktiv|deactiv|suspensión|suspensão|sospensione|blocco|blocage|bloqueo)/i.test(text) ||
    /(suspens|suspensión|suspensão|sospensione|bloqueo|blocco|blokada|sperrung|blocage).{0,120}(account|konto|rekening|cuenta|conta|compte|utente|expediente)/i.test(text);

  const highCondition = externalLinks.length > 0 && (credentialSignal || (urgentSignal && accountThreatSignal));

  if (!highCondition) return ctx;

  const labels = typeof sbImpersonationTextsPatchV1 === "function"
    ? sbImpersonationTextsPatchV1(ctx.userLang, institution.name || "institution")
    : null;

  ctx.fraudRisk.level = "HIGH";
  ctx.fraudRisk.confidence = Math.max(Number(ctx.fraudRisk.confidence || 0), 90);

  if (labels) {
    ctx.fraudRisk.label = labels.label;
    ctx.fraudRisk.summary = labels.summary;
  }

  const signal = labels ? labels.signal : "The institution was recognized, but the link leads outside the official domain.";
  const step1 = labels ? labels.step1 : "Do not click the link in the message.";
  const step2 = labels ? labels.step2 : "Open the official website of the institution manually.";
  const step3 = labels ? labels.step3 : "Do not share login, password, SMS code or banking details.";

  ctx.fraudRisk.signals = Array.from(new Set([
    ...(Array.isArray(ctx.fraudRisk.signals) ? ctx.fraudRisk.signals : []),
    signal
  ])).slice(0, 8);

  ctx.fraudRisk.suspiciousElements = Array.from(new Set([
    ...(Array.isArray(ctx.fraudRisk.suspiciousElements) ? ctx.fraudRisk.suspiciousElements : []),
    ...externalLinks,
    signal
  ])).slice(0, 8);

  ctx.fraudRisk.safeSteps = Array.from(new Set([
    step1,
    step2,
    step3,
    ...(Array.isArray(ctx.fraudRisk.safeSteps) ? ctx.fraudRisk.safeSteps : [])
  ])).slice(0, 8);

  if (Array.isArray(ctx.risks)) {
    ctx.risks = Array.from(new Set([step1, step2, step3, ...ctx.risks])).slice(0, 8);
  }

  if (Array.isArray(ctx.help)) {
    ctx.help = Array.from(new Set([step2, ...ctx.help])).slice(0, 8);
  }

  ctx.urgency = "HIGH";
  if (ctx.legalHelpFinal === "URGENT") ctx.legalHelpFinal = "RECOMMENDED";

  return ctx;
}
