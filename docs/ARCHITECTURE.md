# Architektur

## Komponenten

| Paket/Ort | Inhalt |
|---|---|
| `packages/core` | KDBX-Domänenlogik, **browser-frei** (läuft in Service Worker, Event Page und Node-Tests) |
| `packages/extension` | Extension: Manifest-Templates (Chrome/Firefox), Background, Popup/Options, Content-Script |
| `~/Cloud/kdbx-keychain/` | lokale Kopie der DB (rclone), die GNOME Secrets öffnet |
| `nixos-configuration` (separates Repo) | agenix-Secrets, rclone-Service (Phase 2), gsecrets-Installation (Phase 5) |

## Entscheidungsrecords (ADR)

### ADR-001 — Monorepo, eine Codebasis, zwei Extensions
Chrome MV3 (background `service_worker`) und Firefox MV3 (background `scripts`,
Event Page) unterscheiden sich im Background-Modell. Die Manifeste liegen als
Templates im Repo (`manifest.chrome.json`, `manifest.firefox.json`), der Build
wählt per Flag. UI + Logik sind 100 % geteilt, `webextension-polyfill` glättet
API-Differenzen. Ergebnis: zwei unabhängige Artefakte, keine Duplikation.

### ADR-002 — Konnektoren: Dropbox-API direkt (Extension), rclone (Desktop)
- **Extension ↔ Dropbox REST:** OAuth 2.0 mit **PKCE**. Für PKCE wird das
  App-Secret nicht gebraucht und taucht im Browser-Bundle nicht auf — nur der
  App-Key (Build-Injection aus agenix-Env).
- **Desktop ↔ Dropbox:** rclone bisync zwischen `dropbox:kdbx-keychain/` und
  `~/Cloud/kdbx-keychain/` (systemd user timer, deklarativ via NixOS).
- **Verworfen fürs MVP:** Native-Messaging-Host für die Extension (Setup-Aufwand
  auf jedem Browser-Profil, kein Mehrwert, solange gsecrets über rclone bedient wird).

### ADR-003 — KDBX-Stack: kdbxweb (+ Argon2-WASM) — **entschieden 2026-11-25**
Gewählt: **kdbxweb** (KeeWeb-Familie). Verworfen: **keepass-rs** (Rust) und eigene
Implementierung. Begründung:
- Der Browser ist unsere Laufzeit: Rust würde nach WASM kompiliert — der
  Geschwindigkeitsvorteil von Rust existiert dort nicht. Argon2 ist memory-hard,
  die KDF kostet in beiden Welten gleich viel.
*Bundle-Notiz (Phase 3):* kdbxweb 2.x ist UMD mit Node-Externals — esbuild-Alias
`crypto` → WebCrypto-Shim (`src/shims/crypto-shim.ts`; die Node-API-Pfade sind
nur Fallback im Browser), `@xmldom/xmldom` wird als echtes Paket gebundelt,
weil Service Worker keinen `DOMParser` haben. Verifiziert per Bundle-Smoke-Test
(KDBX-Roundtrip im Browser-Zweig, `SMOKE OK`).
- Eine Toolchain (TS + esbuild + vitest) statt zwei (Rust + wasm-pack + Glue-Code
  + Typen + CI).
- kdbxwebs Edit/Create-API ist produktivreift (KeeWeb): CRUD, Times, protected
  fields, KDBX 3/4, Keyfiles — exakt unser Feature-Set.
- keepass-rs bleibt die Wahl, falls später doch ein nativer Host/das CLI
  dazukommt (ADR-002: fürs MVP verworfen).
Details: Argon2 läuft in einem dedizierten Worker (nicht im UI-/SW-Thread);
CSP `wasm-unsafe-eval` steht in beiden Manifesten. Austauschbarkeit gesichert:
kdbxweb sitzt nur hinter dem `DatabasePort`-Interface (packages/core/src/types.ts).

### ADR-004 — Zugangs-Konzept „Always open“ und seine Grenze
- **Extension:** nach dem Unlock liegen der abgeleitete Schlüssel (Passwort/
  Keyfile) **und der verschlüsselte KDBX-Ciphertext** ausschließlich in
  `chrome.storage.session` (RAM, wird beim Browser-Ende verworfen). Das
  überlebt Service-Worker-Neustarts → „stay open“ für die ganze Browser-Session.
  Auf Disk (`storage.local`) liegt nur der **Ciphertext-Cache** (KDBX bleibt
  AES-256/Argon2-geschützt) — nie Passwort, Keyfile oder abgeleiteter Key.
  Auto-Lock nach Inaktivität (Default 15 min, konfigurierbar; `chrome.alarms`).
- **Desktop:** gsecrets läuft dauerhaft (GNOME-Autostart) und hält die DB offen.
- **Bewusst NICHT:** Master-Passwort oder abgeleiteter Key auf Disk
  (`storage.local`, Datei, Keyring). „Always open über Neustarts“ wäre nur damit
  möglich — abgelehnt.
- **Akzeptierter Kompromiss:** nach Browser-/Rechner-Neustart einmal entsperren.
  Optional später: Freigabe via OS-Keyring (libsecret) als Opt-in.

### ADR-005 — Sync & Konflikte
Optimistische Nebenläufigkeit: vor jedem Upload Dropbox-`rev` via
`files/get_metadata` vergleichen. Fremde `rev` → Konflikt-Dialog (Neu laden /
Überschreiben), nie stilles Overwrite. rclone-bisync führt ein Konflikt-Log.

### ADR-006 — Auto-Fill (Antwort auf Tusks Schwachpunkt)
Eigener Content-Script-Ansatz statt iframe-Injection:
1. Form-Erkennung: `autocomplete`-Attribute, name/id-Heuristik, Passwort-Feld als Anker.
2. URL-Matching: exakt auf eTLD+1-Basis; Subdomain-Treffer mit Hinweis; fremde
   Hosts nie still füllen.
3. Bedienwege: Kontextmenü auf Eingabefeldern, Shortcut (Ctrl+Shift+L), Popup.
4. Local-first: kein Scanning ohne User-Intent.

### ADR-007 — Keys & Secrets (Amendment 2026-11-26: App-Secret)
- In diesem Repo stehen **nur Platzhalter** (`__DROPBOX_APP_KEY__`), ersetzt beim
  Build aus der agenix-entschlüsselten Env (`DROPBOX_APP_KEY`) — siehe
  `scripts/build-extension.sh` (Quelle `/run/agenix/dropbox-keychain-env`).
- **Amendment:** `DROPBOX_APP_SECRET` wird inzwischen ebenfalls injiziert und
  beim `refresh_token`-Grant mitgesendet. Grund: unsere Dropbox-App ist
  confidential — der Grant verlangt client_secret zwingend (empirisch: ohne
  Secret → HTTP 400 „No auth function available", mit → 200). Das Secret liegt
  bereits in agenix und landet nur im lokalen, git-ignoreden dist/-Artefakt.
- **Chrome-ID gepinnt:** öffentlicher RSA-Key im Manifest (`key`-Feld — kein
  Secret) → stabile Extension-ID `giaekmmanecjlcpifjmleemimokmeoka` →
  OAuth-Redirect-URI `https://giaekmmanecjlcpifjmleemimokmeoka.chromiumapp.org/`
  (einmalig in der Dropbox-App-Konsole eintragen). Fallback ohne App-Console-
  Änderung: Refresh-Token in der Options-Seite importieren.
- **Build-Defaults (Phase 3, deklaratives Setup):** aus derselben agenix-Env
  werden zusätzlich `DEFAULT_REMOTE_PATH` (Ziel-Tresor) und optional
  `DROPBOX_REFRESH_TOKEN` injiziert (`src/shared/build-defaults.ts`). Damit
  ist die Extension nach dem Laden vorkonfiguriert: Pfad gesetzt, Dropbox
  verbunden — es bleibt nur Master-Passwort + Keyfile (bewusst NICHT
  injizierbar, ADR-004). Der Token liegt nur im lokalen `dist/`-Artefakt
  (gitignored), nie im Repo.
- `nixos-configuration/secrets/dropbox-keychain-env.age` (Format: export-Zeilen):
  `DROPBOX_APP_KEY`, `DROPBOX_APP_SECRET`, `KDBX_TEST_PASSWORD`.
- Die Test-kdbx liegt **nicht** im Repo; Passwort steht in agenix. Reale Datenbanken
  berühren dieses Repo nie.

### ADR-008 — TOTP
Gelesen werden KeePassXC-Konventionen: `otp`-Feld (`otpauth://…`) sowie Legacy
`TOTP Seed` + `TOTP Settings` (`Periode;Stellen;Algorithmus`). Generierung:
RFC 6238 lokal. Steam-TOTP optional später.

### ADR-009 — Copy-Funktion & Clipboard
Kopieren von Passwort/Username/TOTP/Custom-Fields. Hintergrund-Alarm löscht die
Zwischenablage nach N Sekunden (Default 20, konfigurierbar) — und nur, wenn sie
noch unseren Wert enthält ( überschreibt keine fremden Inhalte).
*Implementierung (Phase 3):* Offscreen-Dokument (`chrome.offscreen`,
Reason CLIPBOARD) schreibt/liest die Zwischenablage; der Alarm vergleicht den
Inhalt mit dem erwarteten Wert (RAM-only im SW) und löscht nur bei Identität.
`chrome.alarms` unterhalb 1 Minute nur in Entpackten Extensions — im Release
ist die effektive Mindestgranularität 60 s (dokumentierte Grenze).

### ADR-010 — Design: libadwaita-inspiriert
Tokens statt Pixelkopie: Akzent `#3584e4`, Cards mit 12 px Radius, dunkles Scheme
via `prefers-color-scheme`, Font-Pfad „Adwaita Sans → Inter → Cantarell“.
Freiheiten ausdrücklich erlaubt (Wunsch), die GNOME-Haptik bleibt erhalten.

### ADR-011 — Popup-UI: Preact, Deklarativität zuerst
Das Popup wird vollständig als Preact-Komponentenbaum (TSX) gerendert — kein
imperativer DOM-Code mehr. Ziel ist „mehr HTML als JS-Ausdrücke“:
- **State lebt im Background** (Snapshot = Quelle der Wahrheit, ADR-004). Das
  Popup ist eine Projektion: Views bekommen Daten als Props, nie via
  DOM-Lesezugriff. Ein gesperrter Tresor überschreibt jede Navigation.
- **Interaktion = Message.** Jede Nutzeraktion schickt eine RuntimeMessage an
  den Router (COPY, SYNC_PUSH, UNLOCK, …) und übernimmt den neuen Snapshot —
  nie einen direkten DOM-Zweig.
- **JSX schlägt Helfer.** Bedingte Abschnitte stehen als JSX-Blöcke
  (`{f.url && <Row … />}`), nicht in h()-Ketten; nur wirklich
  wiederverwendbare Bausteine bleiben Komponenten (Row, IconButton, Banner,
  CopyButton).
- **Icons bleiben inline-SVG** (Lucide, ISC) und werden per
  `dangerouslySetInnerHTML` eingesetzt — kein Font, kein Netz.
- Verworfen: Alpine.js/alpine-ajax (Client-State-Duplikat, `new Function`-Eval
  gegen MV3-CSP, und ohne Server gibt es kein „html over the wire“) sowie
  htmx-Stil (setzt Server voraus, den eine Extension nicht hat). Preact ist
  hier reines Komponenten-Modell (~4 KB), kein Statement über htmx.

## Sicherheitsmodell (Kurz-Threat-Modell)

- At rest ist die KDBX immer verschlüsselt (KDBX4: AES-256 + Argon2id).
- Entsperrt liegt Klartext **nur im RAM** des jeweiligen Prozesses
  (Extension: `storage.session`; gsecrets: eigener Prozess).
- Dropbox sieht ausschließlich Ciphertext.
- Größte Angriffsflächen: Clipboard und Auto-Fill → Auto-Clear (ADR-009),
  Matching nur bei User-Intent (ADR-006).
- Dropbox-Tokens (Extension, rclone) und App-Secret stehen nie in einem Repo.
