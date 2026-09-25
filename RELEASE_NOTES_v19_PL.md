# Sense Bridge v19 — pierwsza modernizacja

Wersja robocza przygotowana na bazie v18. Nie usuwa danych użytkowników ani nie zmienia formatu wdrożenia Netlify.

## Najważniejsze zmiany

- zabezpieczenie operacji administracyjnych `access_set` i `admin_payment_delete` kodem `ADMIN_PIN`;
- obsługa wszystkich 24 języków interfejsu także w analizie po stronie serwera, w tym FI, SV, NO i DA;
- prawidłowy układ RTL dla arabskiego standardowego (AR) i egipskiego (EG);
- krótszy ekran startowy i nowa warstwa wizualna `ui-v20.css`;
- widoczny fokus klawiatury, większe pola dotykowe i obsługa ograniczenia animacji;
- limity wielkości zapytań dla analizy i OCR oraz walidacja formatu obrazu;
- oddzielenie treści dokumentu od instrukcji dla modelu AI;
- nagłówki bezpieczeństwa Netlify;
- automatyczne testy regresji języków, bezpieczeństwa, UI i wymaganych plików.

## Zmienione lub nowe pliki

- `index.html`
- `reference-design.css`
- `ui-v20.css` (nowy)
- `netlify.toml`
- `netlify/functions/access_set.js`
- `netlify/functions/admin_payment_delete.js`
- `netlify/functions/analyze.js`
- `netlify/functions/ocr.js`
- `package.json`
- `package-lock.json` (nowy)
- `tests/static-regression.test.js` (nowy)

Usunięto pusty plik tymczasowy `languages/v22-expansion.js.tmp`.

## Kontrola jakości

- 8/8 testów regresji: zaliczone;
- 4/4 testy wykonawcze obsługi błędnych metod i danych: zaliczone;
- kontrola składni wszystkich funkcji Netlify: zaliczona.

## Wymagana konfiguracja

W środowisku Netlify musi być ustawiona zmienna `ADMIN_PIN`. Bez niej operacje administracyjne celowo zwrócą błąd 503.

## Znane zadanie na kolejny etap

Pełne zabezpieczenie kosztów AI wymaga przeniesienia uprawnień użytkownika z pamięci przeglądarki do sesji serwerowej i wprowadzenia serwerowych limitów użycia. To powinno zostać wdrożone jako osobna, testowana migracja, aby nie zablokować obecnych użytkowników.
