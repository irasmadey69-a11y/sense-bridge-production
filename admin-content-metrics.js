(() => {
  function n(value) {return Math.max(0, Number(value) || 0);}
  function table(id, headings, rows) {
    const box = document.getElementById(id);
    box.replaceChildren();
    if (!rows.length) {const text = document.createElement('p'); text.textContent = 'Brak zarejestrowanych danych.'; box.append(text); return;}
    const element = document.createElement('table');
    const head = document.createElement('thead'); const headingRow = document.createElement('tr');
    headings.forEach(label => {const cell = document.createElement('th'); cell.scope = 'col'; cell.textContent = label; headingRow.append(cell);});
    head.append(headingRow); element.append(head);
    const body = document.createElement('tbody');
    rows.forEach(values => {const row = document.createElement('tr'); values.forEach(value => {const cell = document.createElement('td'); cell.textContent = String(value); row.append(cell);}); body.append(row);});
    element.append(body); box.append(element);
  }
  function aggregate(rows, dimensions) {
    const result = new Map();
    rows.forEach(row => {
      const labels = dimensions.map(key => row[key]); const key = JSON.stringify(labels);
      const item = result.get(key) || {labels};
      for (const ev of ['page_view', 'app_click', 'app_arrival', 'install_click', 'install_confirm']) item[ev] = n(item[ev]) + n(row[ev]);
      result.set(key, item);
    });
    return [...result.values()].sort((a, b) => (b.page_view + b.install_click) - (a.page_view + a.install_click));
  }
  window.loadContentStats = async () => {
    const message = document.getElementById('contentStatsMsg');
    const pin = getPin();
    if (!pin) {message.textContent = 'Wpisz PIN admina.'; return;}
    message.textContent = 'Pobieram statystyki podstron…';
    try {
      const response = await fetch('/.netlify/functions/content-stats', {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({adminPin: pin})});
      const data = await response.json();
      if (!response.ok || !data.ok) throw new Error('Nie udało się pobrać statystyk. Sprawdź PIN i spróbuj ponownie.');
      const rows = Object.values(data.snapshot.rows || {});
      const sourceRows = aggregate(rows, ['page', 'pageLang']);
      table('contentPageStats', ['Podstrona', 'Język strony', 'Wizyty', 'Kliknięcia aplikacji', 'Otwarcia aplikacji', 'Kliknięcia ikony', 'Potwierdzone instalacje'], sourceRows.map(row => [...row.labels, row.page_view, row.app_click, row.app_arrival, row.install_click, row.install_confirm]));
      const languageRows = aggregate(rows.filter(row => row.page !== 'DIRECT_APP'), ['pageLang']);
      table('contentLanguageStats', ['Język strony', 'Wizyty', 'Kliknięcia aplikacji', 'Otwarcia aplikacji', 'Kliknięcia ikony', 'Potwierdzone instalacje'], languageRows.map(row => [...row.labels, row.page_view, row.app_click, row.app_arrival, row.install_click, row.install_confirm]));
      const appRows = aggregate(rows.filter(row => row.install_click || row.install_confirm), ['appLang']);
      table('contentAppLanguageStats', ['Język aplikacji', 'Kliknięcia ikony od uruchomienia modułu', 'Potwierdzone instalacje od uruchomienia modułu'], appRows.map(row => [...row.labels, row.install_click, row.install_confirm]));
      const old = data.installationLanguages;
      const languages = [...new Set([...Object.keys(old.clicks || {}), ...Object.keys(old.confirmed || {})])];
      table('installationLanguageStats', ['Język aplikacji', 'Dotychczasowe kliknięcia ikony', 'Dotychczasowe potwierdzone instalacje'], languages.sort((a, b) => n(old.confirmed[b]) - n(old.confirmed[a])).map(lang => [lang, n(old.clicks[lang]), n(old.confirmed[lang])]));
      document.getElementById('contentSince').textContent = data.snapshot.since ? new Date(data.snapshot.since).toLocaleString('pl-PL') : 'Brak zdarzeń — pomiar jeszcze się nie rozpoczął';
      message.textContent = 'Statystyki podstron odświeżone.';
    } catch (error) {message.textContent = error.message || 'Błąd pobierania statystyk.';}
  };
})();
