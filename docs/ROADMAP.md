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

## Phase 1 — Core-Bibliothek (`packages/core`) ✅ (2026-11-25)
- [x] kdbxweb + **hash-wasm** als Argon2 (reines WASM, identisch in Node-Tests
      und Browser-Bundle; via `CryptoEngine.setArgon2Impl`-Hook)
- [x] `open` (Passwort **und** `.key`-Datei), list/search/matchUrl,
      create/update/remove, serialize
- [x] TOTP-Parser (`otp://` + Legacy-Felder) + RFC-6238-Generator
- [x] Test-Fixtures werden **in den Tests programmatisch erzeugt** (kein `.kdbx` im Git)
- **Ergebnis:** 37/37 Tests grün, `tsc --noEmit` sauber. Cross-Writer-Check:
  die pykeepass-erzeugte Test-DB (Argon2id) öffnet und liest sich sauber via
  kdbxweb → Kompatibilität mit GNOME-Secrets-tauglichen KDBX4-Dateien bestätigt.
  SHA256/512-TOTP-Vektoren gegen pyotp referenziert (publizierte RFC-Anhang-B-
  Werte ab T=1111111109 sind als inkonsistent dokumentiert — im Test vermerkt).
- **Akzeptanz erfüllt:** Unit-Tests grün; Open→Edit→Save→Open-Roundtrip;
  Keyfile-Pfad getestet (ohne .key → InvalidKey, mit → Zugriff).

## Phase 2 — Dropbox-Layer + Desktop-Sync (Teil 1 ✅ Desktop, 2026-11-25)
- [x] Dropbox-OAuth über App Console (Redirect-URI `http://localhost:53682/`,
      Scopes files.metadata/content.read+write) — Token in `~/.config/rclone/rclone.conf` (600)
- [x] rclone-bisync systemd-User-Service + 5min-Timer (nixcfg `modules/rclone-kdbx.nix`)
- [x] test.kdbx hochgeladen → `dropbox:kdbx-keychain/test.kdbx`; erster Resync gelaufen
- [ ] Extension-seitiger Dropbox-Adapter (`CloudPort`): OAuth-PKCE im Browser,
      Token-Refresh, fetch/put mit rev-Prüfung (ADR-005) — nächster Schritt
- **Akzeptanz (Desktop-Teil):** gsecrets ↔ Dropbox bidirektional aktiv (Timer)

## Phase 3 — Extension-MVP (Chrome zuerst)
- ✅ Unlock-Screen (Passwort + optionale `.key`-Datei), Stay-open über
  `storage.session` (ADR-004), Auto-Lock-Timer (Vault-Service, 16 Unit-Tests)
- ✅ Popup (GNOME-Design): Suche, Eintrag-Detail, Copy mit Auto-Clear (ADR-009,
  Offscreen-Dokument + Alarm, vergleicht vor dem Löschen), TOTP mit Countdown,
  Create/Edit/Delete (inkl. TOTP-Entfernen), Sync-Status + Konflikt-Dialog
- ✅ Auto-Fill v1: Content-Script-Heuristik (pure getestet: Anker-Regel,
  autocomplete-Priorität, Captcha-Negativliste) + Kontextmenü + Ctrl+Shift+L
- ✅ Options-Seite: Auto-Lock-Minuten, Clipboard-Clear-Sekunden, Remote-Pfad,
  Dropbox-Connect (PKCE via `chrome.identity`) + Refresh-Token-Import
- ✅ Build: esbuild + Manifest-Transform für chrome/firefox; `__DROPBOX_APP_KEY__`
  aus agenix-Env (`scripts/build-extension.sh`); Extension-ID gepinnt (public
  key im Manifest) → stabile Redirect-URI; kdbxweb-UMD-Bundle mit
  `crypto`-Stub + echter `@xmldom/xmldom` (SW hat keinen DOMParser);
  Bundle-Smoke-Test (DB-Roundtrip im Browser-Zweig) grün; 77 Tests + tsc
  strict sauber
- ⏳ **Akzeptanz (live):** Extension in Chrome laden (`dist/chrome`), Demo-Login
  (`scripts/serve-demo.sh` → http://127.0.0.1:8123) füllen; CRUD landet in
  Dropbox und (via rclone-Sync) in gsecrets. Für PKCE-Connect einmalig die
  Redirect-URI `https://giaekmmanecjlcpifjmleemimokmeoka.chromiumapp.org/`
  in der Dropbox-App-Konsole ergänzen (alternativ Refresh-Token in Options
  importieren).

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
