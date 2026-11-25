# Reihenfolge (Roadmap)

Festgelegt 2026-11-25. Phasen laufen der Reihe nach; jede hat Akzeptanzkriterien.
Kleine Überschneidungen sind ok (z. B. rclone-Setup parallel zu Phase 1), aber
**Phase N+1 startet nicht vor Abnahme von Phase N**, außer explizit vermerkt.

## Phase 0 — Fundament & Secrets ✅
- [x] Monorepo-Struktur + Doku (README, ARCHITECTURE/ADRs, diese Datei)
- [x] Repo auf GitHub: `Jannis789/kdbx-keychain-extension` (pushed)
- [x] Dropbox App-Key/-Secret + Test-DB-Passwort in **agenix** (nixos-configuration),
      null Keys in diesem Repo (ADR-007)
- [x] Test-kdbx lokal erzeugt: `~/Cloud/kdbx-keychain/test.kdbx`
      (Dummy-Einträge, TOTP modern + legacy, protected Custom Fields)
- [ ] `rclone authorize dropbox` (interaktiv — dein Klick im Browser), Token →
      `~/.config/rclone/rclone.conf` (chmod 600); danach Upload nach
      `dropbox:kdbx-keychain/test.kdbx`

## Phase 1 — Core-Bibliothek (`packages/core`)
- kdbxweb + Argon2-WASM-Setup; `open` (Passwort **und** `.key`-Datei),
  list/search/matchUrl, create/update/remove, serialize
- TOTP-Parser (`otp://` + Legacy-Felder) + RFC-6238-Generator
- Test-Fixtures werden **in den Tests programmatisch erzeugt** (kein `.kdbx` im Git)
- **Akzeptanz:** Unit-Tests grün; Open→Edit→Save→Open-Roundtrip; Keyfile-Pfad getestet

## Phase 2 — Dropbox-Layer + Desktop-Sync
- OAuth PKCE im Extension-Kontext (App-Key via Build-Env), Token-Refresh,
  fetch/put mit rev-Prüfung (ADR-005)
- rclone: bisync systemd-user-Service in der nixos-configuration (Timer,
  Konflikt-Log), Upload der Test-DB
- **Akzeptanz:** Extension-Testbuild kann test.kdbx ziehen und zurückschreiben;
  lokale Kopie bidirektional synced; Konfliktfall wird erkannt, nicht still überschrieben

## Phase 3 — Extension-MVP (Chrome zuerst)
- Unlock-Screen (Passwort + optionale `.key`-Datei), Stay-open über
  `storage.session` (ADR-004), Auto-Lock-Timer
- Popup (GNOME-Design): Suche, Eintrag-Detail, Copy mit Auto-Clear (ADR-009),
  TOTP-Anzeige mit Countdown, Create/Edit/Delete, Sync-Status + Konflikt-Dialog
- Auto-Fill v1: Content-Script-Heuristik + Kontextmenü + Shortcut (ADR-006)
- Options-Seite: Auto-Lock-Minuten, Clipboard-Clear-Sekunden, Remote-Pfad
- **Akzeptanz:** Login auf einer Demo-Seite füllen; CRUD landet in Dropbox und
  (via rclone-Sync) in gsecrets

## Phase 4 — Firefox-Build
- Manifest-Transform (background.scripts statt service_worker),
  `webextension-polyfill`, `storage.session`-Verifikation, Tests mit `web-ext run`
- **Akzeptanz:** gleicher Feature-Stand wie Chrome, UI-Code unverändert

## Phase 5 — GNOME-Integration
- gsecrets in nixos-configuration installieren (GNOME-Modul)
- test.kdbx aus `~/Cloud/kdbx-keychain/` öffnen; Keyfile-Support prüfen;
  „offen lassen“ + Autostart verifizieren
- Evaluieren: gsecrets als **Secret-Service-Provider** (D-Bus) — Bonus für
  System-Integration, hängt von der aktuellen gsecrets-Version ab (lokal verifizieren)
- **Akzeptanz:** dieselbe DB in gsecrets UND Extension; Änderungen laufen in beide
  Richtungen (Extension → Dropbox → rclone → Datei → gsecrets und zurück)

## Phase 6 — Härtung & Release
- Auto-Fill v2 (iframes, Shadow DOM, SPA-Formulare), Lock-Policy-Feinschliff,
  CSP-Audit, CI (Tests + beide Builds), Store-Pakete (Chrome Web Store + AMO)

## Offene Entscheidungen (Veto möglich)
- **D1** Pfade: `dropbox:kdbx-keychain/test.kdbx` ↔ `~/Cloud/kdbx-keychain/test.kdbx`
- **D2** Chrome zuerst, Firefox direkt danach (eine Codebasis, ADR-001)
- **D3** Bibliothek: **✅ entschieden 2026-11-25: kdbxweb** statt keepass-rs
  (Begründung: ADR-003; Rust→WASM-Parität, eine Toolchain, reifere Edit-API)
- **D4** Stay-open endet mit Browser-Ende — kein Key auf Disk (ADR-004)
