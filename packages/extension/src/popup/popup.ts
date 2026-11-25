// Phase-0-Skeleton: zeigt Design-Richtung mit Demo-Daten.
// Phase 3 bindet core + messaging (chrome.runtime) an.

interface DemoRow {
  title: string;
  username: string;
  totp?: boolean;
}

const demo: DemoRow[] = [
  { title: 'Demo Wiki', username: 'demo@example.com', totp: true },
  { title: 'Legacy TOTP Style', username: 'legacy@example.net' },
  { title: 'Custom Fields Demo', username: 'user@corp.example' },
];

const list = document.getElementById('entries');
if (list) {
  for (const row of demo) {
    const li = document.createElement('li');
    li.className = 'row card';
    li.innerHTML = `
      <div class="row-main">
        <span class="title"></span>
        <span class="sub"></span>
      </div>
      ${row.totp ? '<span class="chip totp">TOTP</span>' : ''}
      <button class="icon-btn" title="Passwort kopieren">⧉</button>`;
    // TextContent statt Interpolation: kein HTML-Injection-Vektor, auch im Mock.
    (li.querySelector('.title') as HTMLElement).textContent = row.title;
    (li.querySelector('.sub') as HTMLElement).textContent = row.username;
    list.appendChild(li);
  }
}
