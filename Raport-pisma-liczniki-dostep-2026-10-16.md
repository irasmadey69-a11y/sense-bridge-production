# Sense Bridge — pisma, liczniki i prośby o dostęp

16.10.2026. Nie wykonano deploya. Poniższe próby w aplikacji dotyczą dotychczasowej wersji; poprawki sprawdzono lokalnie, z symulowanymi usługami.

## Prośby o dalszy dostęp

Potwierdzono błąd w kodzie: panel i API wybierały większą wartość z dwóch różnych liczników. Starsza wartość 35 zasłaniała nowy licznik zapisanych próśb. Test odtwarza sytuację: starszy licznik 35, zapisane prośby 1; przed poprawką wynik wynosił 35, po poprawce 1 i osobno 35 jako historia starszego licznika.

Rozdzielono „Zapisane prośby o dostęp” i „Starszy licznik kliknięć / próśb”. Nie usuwano ani nie zerowano zapisanych danych. Wartości 35 nie można traktować jako dowodu 35 różnych zapisanych zgłoszeń. Otwarcie okna i sprawdzenie już aktywnego dostępu nie oznacza wysłania nowej prośby.

Naprawiono scalanie informacji o wysyłce maila w kolejce administratora. Dotychczas wcześniejszy rekord zasłaniał późniejsze informacje, co mogło wyświetlać „Mail admina: —”. Dodano limit czasu i ponowienie wysyłki z tym samym kluczem zapobiegającym podwójnej wysyłce. Awaria licznika nie blokuje prośby ani wiadomości, a awaria wiadomości nie usuwa zapisanej prośby. Zachowano aktualny status użytkownika przy równoległej aktywacji.

Nie potwierdzono dostarczenia nowej wiadomości z poprawionej wersji: nie jest wdrożona. Nie wysyłano sztucznego nowego zgłoszenia ani nie zmieniano dostępu użytkowników podczas testu.

## Cztery trudne pisma w działającej aplikacji

| Próba | Wynik starej wersji | Wprowadzona poprawka |
| --- | --- | --- |
| Niderlandzkie: korekta 120 na 100 EUR, wpłata 40, saldo 60, dwa terminy | Tłumaczenie poprawne; podsumowanie pomijało kwoty i terminy, dodawało nieopisane konsekwencje | Obowiązek zachowania korekt, kwot, terminów i warunków; dodatkowa kontrola odpowiedzi |
| Niemieckie: zmiana wizyty, potwierdzenie obecności, nie trzeba być na czczo | Nowa data poprawna; gotowa odpowiedź deklarowała obecność bez decyzji użytkownika | Wszystkie tony odpowiedzi mają zachować ten sam zamiar, bez samodzielnych zobowiązań |
| Angielskie: fałszywy urząd, podejrzany adres i żądanie hasła oraz kodu SMS | Wysokie ryzyko wykryte; instrukcja nakazująca AI uznać wiadomość za bezpieczną zignorowana; część porad zbyt ogólna | Wzmocniono zakaz wykonywania instrukcji z dokumentu i dopowiadania faktów |
| Francuskie: dokumenty zależne od rodzaju zatrudnienia | Tłumaczenie poprawne; „indépendant” błędnie rozpoznane jako IND/NL; nieuzasadnione zobowiązanie w odpowiedzi | Granice słów uwzględniają Unicode; instytucja musi mieć oparcie w źródle; test IND oraz café/CAF |

Nowa główna analiza używa kontroli jakości całego wyniku. Może to zwiększyć czas i koszt odpowiedzi. Testy lokalne sprawdzają przepływ i zabezpieczenia, nie dowodzą jakości odpowiedzi prawdziwego modelu po wdrożeniu.

## Liczniki

W działającej wersji kontrolowane odświeżenie dało: wejścia 3203→3204, otwarcia aplikacji 2971→2972, powtórne otwarcia 2491→2492. Kolejna zakończona analiza pisma: 718→719; użycie LETTER_ANALYSIS 46→47. Odczytano również pozostałe liczniki narzędzi i statusów. Nie testowano na żywo przyznawania, blokowania ani usuwania dostępów.

Lokalnie sprawdzono mapowanie wszystkich 28 dozwolonych zdarzeń do statystyk, równoległe zapisy, liczenie zakończonych analiz, OCR i użycia modeli, statusy po wygaśnięciu oraz przypadki awarii statystyk i maila. Dodano warunkowe zapisy z ponowieniem, by ograniczyć utratę równoległych przyrostów. Liczniki nadal nie są księgowym rejestrem gwarantującym zapis mimo każdej awarii infrastruktury.

Ujednolicono adres zdarzeń z bieżącym wdrożeniem i poprawiono przekazywanie języka. Nowy klient wysyła jedno połączone zdarzenie analizy; zachowano zgodność ze starym klientem. Udany OCR liczony jest po otrzymaniu tekstu. Koszty opisano jako szacunek, a plan PRO oddzielono opisem od aktualnego statusu dostępu.

## Paczki i weryfikacja

33/33 testów lokalnych zakończonych powodzeniem. 58 kontroli składni JavaScript zakończonych powodzeniem. ZIP-y sprawdzone pod kątem integralności.

Paczki zawierają wcześniejsze poprawki po 42 próbach dodatkowych funkcji i niniejsze poprawki. Zachowano piaskowy motyw startowy. Wymagane są również nowe pliki pomocnicze oraz package.json i package-lock.json z @netlify/blobs 10.5.0 — nie pomijać ich przy podmianie.

Przed produkcyjnym wdrożeniem należy uruchomić podgląd nowej wersji, powtórzyć cztery pisma oraz przeprowadzić rzeczywisty test nowej prośby o dostęp i odbioru maila. Żaden wynik starej strony nie potwierdza działania niewdrożonej poprawki.

## Skrót do telefonu

Brakowało rejestracji kliknięcia przycisku. Dodano oddzielne zdarzenie shortcut_click i pole „Kliknięcia Dodaj do telefonu”. Istniejący shortcut_add jest wywoływany po zdarzeniu appinstalled. Nie zalicza się samej akceptacji okna jako ukończonej instalacji. Anulowanie i otwarcie instrukcji zwiększają wyłącznie kliknięcia; ponowne zdarzenie appinstalled w tej samej sesji nie dubluje instalacji. Testy potwierdzają też blokadę podwójnego kliknięcia w trakcie otwartego natywnego monitu oraz brak naliczeń w już zainstalowanej aplikacji.

Przeglądarki bez appinstalled, w tym ręczne dodawanie na iOS, nie dają wiarygodnego potwierdzenia każdej instalacji. Nie dorabiano potwierdzeń z samego uruchomienia aplikacji ani nie uzupełniano historycznych kliknięć. Dotychczasowy odczyt instalacji wynosił 227; nie oznacza to 227 instalacji niezależnie zweryfikowanych w tym audycie. Nowy licznik kliknięć zacznie zbierać dane po wdrożeniu. Nie instalowano skrótu na urządzeniu użytkownika podczas testów.

## Ostatnia poprawka przed deployem — rozpoznawanie instytucji

Usunięto rozpoznawanie szpitala ETZ na podstawie samego imienia Elisabeth lub fragmentu słowa, np. niemieckiego Gesetz. Poprawiono także klasyfikację takich pism jako medycznych. Pełna nazwa szpitala, samodzielny skrót ETZ i MijnETZ nadal są rozpoznawane.

Niepoparta tekstem instytucja podana przez model z wysoką pewnością nie blokuje już rozpoznania instytucji rzeczywiście obecnej w piśmie. Nazwa, kraj i adres instytucji są aktualizowane razem, bez zachowywania danych poprzedniej błędnej propozycji. Dodano dwa testy regresyjne; pełny zestaw: 33/33. Model API pozostawiono bez zmiany. Nie wykonano deploya.
