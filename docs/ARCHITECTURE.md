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

### ADR-003 — KDBX-Stack: kdbxweb (+ Argon2-WASM)
kdbxweb (KeeWeb-Familie): KDBX 3/4, Argon2id, Keyfiles. Braucht CSP
`wasm-unsafe-eval` (steht in beiden Manifesten). Alternativen (eigene
KDBX-Implementierung, keepassxc via native messaging) verworfen: Aufwand
bzw. externes Binär-Setup.

### ADR-004 — Zugangs-Konzept „Always open“ und seine Grenze
- **Extension:** nach dem Unlock liegt der abgeleitete Schlüssel ausschließlich
  in `chrome.storage.session` (RAM, wird beim Browser-Ende verworfen). Das
  überlebt Service-Worker-Neustarts → „stay open“ für die ganze Browser-Session.
  Auto-Lock nach Inaktivität (Default 15 min, konfigurierbar).
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

### ADR-007 — Keys & Secrets
- In diesem Repo stehen **nur Platzhalter** (`__DROPBOX_APP_KEY__`), ersetzt beim
  Build aus der agenix-entschlüsselten Env (`DROPBOX_APP_KEY`).
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

### ADR-010 — Design: libadwaita-inspiriert
Tokens statt Pixelkopie: Akzent `#3584e4`, Cards mit 12 px Radius, dunkles Scheme
via `prefers-color-scheme`, Font-Pfad „Adwaita Sans → Inter → Cantarell“.
Freiheiten ausdrücklich erlaubt (Wunsch), die GNOME-Haptik bleibt erhalten.

## Sicherheitsmodell (Kurz-Threat-Modell)

- At rest ist die KDBX immer verschlüsselt (KDBX4: AES-256 + Argon2id).
- Entsperrt liegt Klartext **nur im RAM** des jeweiligen Prozesses
  (Extension: `storage.session`; gsecrets: eigener Prozess).
- Dropbox sieht ausschließlich Ciphertext.
- Größte Angriffsflächen: Clipboard und Auto-Fill → Auto-Clear (ADR-009),
  Matching nur bei User-Intent (ADR-006).
- Dropbox-Tokens (Extension, rclone) und App-Secret stehen nie in einem Repo.
