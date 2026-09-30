# Naprawa inicjalizacji — 30.09.2026

Na działającej stronie brakowało languages/job-offer-24.js (404). To powodowało błąd Object.entries(window.SBJobCopy), przerywający inicjalizację całego panelu dokumentów. Interfejs i wszystkie 24 tłumaczenia narzędzia są teraz osadzone bezpośrednio w index.html. Nie wymagają osobnego wgrania dwóch plików JavaScript.

Wgraj poprawiony index.html. Funkcje backendowe netlify/functions/ai-job-offer.js oraz netlify/functions/_job-wages.js muszą również znajdować się w repozytorium i zostać wdrożone przez Netlify. Najbezpieczniej wgrać zawartość całego pakietu.

Potwierdzono błąd na stronie produkcyjnej w przeglądarce; poprawiony pakiet nie został przez nas wdrożony. Testy kodu korzystają z symulowanych odpowiedzi API.

---

# Uproszczony panel — aktualizacja 30.09.2026

Na początku wystarczy zdjęcie/zrzut ekranu lub tekst i przycisk „Wyjaśnij ofertę”. Pola dodatkowe są schowane w rozwijanej sekcji „Dodatkowe dane — opcjonalnie”.

Kraj pracy i rodzaj zatrudnienia są uzupełniane z ogłoszenia tylko przy jednoznacznej informacji i cytacie źródłowym. Wiek nigdy nie jest zgadywany. Wybór użytkownika ma pierwszeństwo. Sama nazwa miasta, język lub adres agencji nie wystarczają do rozpoznania kraju pracy.

Po analizie, jeśli brakuje danych osobowych/kraju/umowy do porównania płacy, pojawia się lista braków i przycisk otwierający dane opcjonalne. Po ich uzupełnieniu „Oblicz różnicę — bez kolejnego użycia AI” przelicza wynik na serwerze z wcześniej odczytanej stawki. Nie odpytuje OpenAI i nie odejmuje kolejnego użycia. Nadal mogą pozostać inne przeszkody, np. brak stawki brutto, inna jednostka, brak pełnego etatu albo nieobsługiwany kraj. Wyjaśnienie podaje karta wynagrodzenia.

Wdrażaj cały pakiet, także ai-job-offer.js oraz oba pliki językowe/interfejsu. Nie zmieniono liczników administracyjnych ani zasad pozostałych narzędzi.

Walidacja aktualizacji: 17 testów kodu przeszło, w tym obsługa formularza w symulowanym DOM i symulowane odpowiedzi API. Nie testowano rzeczywistego OpenAI ani strony produkcyjnej w tej aktualizacji.

---

# Zrozum ofertę pracy - 30.09.2026

Pakiet przygotowano na bazie sense-bridge-production-main (22).zip.

## Co dodano

- Nowy kafelek w Narzędziach AI, z ikoną teczki i własnym kolorem.
- Ogłoszenie jako tekst, zdjęcie lub zrzut ekranu; zdjęcia korzystają z dotychczasowego OCR.
- Opcjonalny profil: doświadczenie, języki, certyfikaty i oczekiwania.
- Pięć części analizy oraz osobna karta porównania wynagrodzenia.
- Wybór kraju pracy niezależny od języka i krajowego wariantu odpowiedzi.
- Interfejs w 24 językach, odpowiedzi według wybranego języka i jego regionalnego wariantu.
- Pytania do rekrutera, zgłoszenie i przygotowanie rozmowy w wybranym języku, z wyjaśnieniem dla użytkownika, gdy języki się różnią.
- Kopiowanie przygotowanej wiadomości. Wiadomości nie są wysyłane automatycznie.
- Wspólny dotychczasowy limit: analiza oraz każde dodatkowe generowanie zużywają po jednym użyciu dopiero po sukcesie. Odczyt zdjęcia korzysta z istniejącego OCR.
- Cztery liczniki w adminie i kategorie kosztów w dotychczasowej telemetrii, bez zapisywania tekstu ogłoszenia lub profilu.

## Porównanie wynagrodzenia

Różnica w kwocie i procentach jest obliczana przez kod, nie przez model. Zachowane są dolna i górna granica widełek. Kwota musi być poparta fragmentem ogłoszenia zawierającym wynagrodzenie. Nie porównujemy netto do brutto, nie dopisujemy niepodanej podstawy i nie traktujemy niejasnego pakietu z dodatkami jako podstawy.

Tabela została sprawdzona 30.09.2026. Jest dostarczona razem z kodem, więc porównanie nie wymaga osobnego wyszukiwania internetu dla każdej analizy. To porównanie podstawy z krajową wartością odniesienia, nie potwierdzenie zgodności całego wynagrodzenia z przepisami ani weryfikacja dostępności wakatu lub pracodawcy.

Zakres danych:

- Holandia: stawki godzinowe według wieku, styczeń-czerwiec i lipiec-grudzień 2026; odrębne zasady nauki zawodu nie są automatycznie porównywane.
- Niemcy: ogólna stawka dla dorosłych, 2026; branżowe minimum może być wyższe.
- Wielka Brytania: stawki dla wieku 18-20 i 21+, od kwietnia 2026 do marca 2027; nauka zawodu wymaga odrębnego ustalenia.
- Francja: stawka godzinowa dla dorosłych od czerwca 2026; przegląd danych wymagany po 31.10.2026.
- Polska: kwota miesięczna, tylko gdy ogłoszenie wyraźnie dotyczy pełnego etatu i użytkownik wybierze umowę o pracę. To krajowy punkt odniesienia, a nie ocena wszystkich zaliczanych składników wynagrodzenia. Nie stosujemy stawki umów cywilnoprawnych do umowy o pracę.
- Belgia: informacja o GGMMI i link do stawek branżowych. GGMMI nie jest jednolitą podstawą godzinową; nie obliczamy z niego różnicy do stawki godzinowej. Właściwe porównanie wymaga komisji branżowej, kategorii i zasad umowy. Przegląd danych wymagany po 31.10.2026.
- Inne kraje: analiza ogłoszenia działa; porównanie płacy informuje o braku zweryfikowanej stawki. Nie używamy stawek zapamiętanych przez model.

Tabela nie aktualizuje się automatycznie. Przy zmianach należy aktualizować netlify/functions/_job-wages.js na podstawie źródeł urzędowych. Po końcu okresu obsługi stawka przestaje być używana. Historyczne porównanie jest możliwe po wybraniu daty w obsługiwanym okresie.

## Wdrożenie

1. Rozpakuj ZIP.
2. Wgraj zawartość katalogu sense-bridge-production-main do dotychczasowego projektu, zachowując strukturę katalogów.
3. Wdróż cały pakiet przez istniejący proces budowania Netlify. Samo wgranie index.html nie wystarczy.
4. Zachowaj istniejącą zmienną OPENAI_API_KEY. Nie wklejaj jej do plików. Nie dodano nowego płatnego źródła ani wyszukiwarki internetowej.
5. Po wdrożeniu sprawdź nowe narzędzie i cztery liczniki w adminie.

Nowe pliki potrzebne na serwerze: job-offer.js, languages/job-offer-24.js, netlify/functions/ai-job-offer.js oraz netlify/functions/_job-wages.js. Zmienione: index.html, admin.html, netlify/functions/stats.js i netlify/functions/track_event.js. Zawartość pozostałych wcześniejszych plików zachowano.

## Próba po wdrożeniu

W Narzędziach AI wybierz Zrozum ofertę pracy. Wklej:

    Magazijnmedewerker in Tilburg. Bruto basisloon: 16,00 EUR per uur.
    Dagdienst maandag-vrijdag 07:30-16:30. Nederlands vereist.
    Heftruckcertificaat is een pluspunt. Uitzendcontract, 40 uur per week.

Wybierz kraj Holandia, wiek 35, umowę o pracę i datę 30.09.2026. Oczekiwana różnica: +1,01 EUR/h i +6,74% względem 14,99 EUR/h. Następnie sprawdź wiadomość po niderlandzku i jej wyjaśnienie w języku użytkownika.

Sprawdź też: ogłoszenie bez płacy, płacę netto, zdjęcie, język japoński/arabski, kraj Belgia, oraz licznik w adminie. Wynik belgijski powinien wskazać potrzebę ustalenia minimum branżowego, bez fikcyjnego przeliczenia GGMMI na godzinę.

## Weryfikacja lokalna

- 14 testów logiki i endpointu: daty, wiek, widełki, waluty, netto/brutto, dodatki, Belgia, etat w Polsce, dowód kwoty, błędy API i kompletność 24 języków.
- Parsowanie skryptów index.html oraz nowych plików JavaScript.
- Rzeczywisty panel w lokalnej przeglądarce: telefon, komputer, tryb ciemny, zmiana PL/NL/JA/AR/EN, lista krajów, wynik porównania, dodatkowe działania, limit, wyczyszczenie danych, zdjęcie/OCR i błąd bez potrącenia użycia.
- Odpowiedzi AI/OCR i zdarzenia serwera były w testach przeglądarkowych symulowane. Nie wykonano płatnej próby rzeczywistego modelu ani wdrożenia na produkcję. Wymagane jest sprawdzenie po wdrożeniu z istniejącym kluczem.

## Źródła stawek

- https://www.government.nl/themes/work/minimum-wage/minimum-wage-amounts
- https://www.bmas.de/DE/Arbeit/Arbeitsrecht/Mindestlohn/mindestlohn.htm
- https://www.gov.uk/national-minimum-wage-rates
- https://www.service-public.gouv.fr/particuliers/vosdroits/F2300
- https://www.gov.pl/web/rodzina/minimalne-wynagrodzenie-za-prace
- https://www.vlaanderen.be/werken/een-buitenlander-in-vlaanderen-tewerkstellen/lonen-en-toeslagen
- https://minimumlonen.be/index.html?lang=nl
