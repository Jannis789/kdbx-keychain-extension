# kdbx-keychain

Eigener Passwort-Manager-Stack um **eine** KDBX-Datei als Source of Truth auf Dropbox.

| Komponente | Rolle |
|---|---|
| **GNOME Secrets** (gsecrets) | Desktop-Client, öffnet die lokal synchronisierte Kopie |
| **Browser-Extension** | Chrome + Firefox aus **einer** Codebasis: Auto-Fill, TOTP, Copy, CRUD, Stay-open-Session |
| **rclone** | Desktop-Konnektor: Dropbox ↔ `~/Cloud/kdbx-keychain/` (bidirektional, systemd-Timer) |
| **Dropbox** | Source of Truth: `dropbox:kdbx-keychain/test.kdbx` |
| **agenix** | Dropbox-Keys + Test-DB-Passwort (liegen im *nixos-configuration*-Repo, **nie** hier) |

```
              ┌────────────────────────── Dropbox ──────────────────────────┐
              │   kdbx-keychain/test.kdbx  (verschlüsselt, Source of Truth) │
              └──────────────┬──────────────────────────────┬───────────────┘
                             │ Dropbox REST API             │ rclone bisync
                             │ (OAuth PKCE, App-Key wird    │ (systemd user timer,
                             │  beim Build aus ageniz-Env   │  bidirektional)
                             │  injiziert)                  │
              ┌──────────────▼─────────────┐   ┌────────────▼───────────────┐
              │ Browser-Extension          │   │ ~/Cloud/kdbx-keychain/     │
              │ Chrome MV3 + Firefox MV3   │   │ lokale Kopie               │
              │ core: kdbxweb + TOTP       │   └────────────┬───────────────┘
              │ Unlock: storage.session    │                │ Datei öffnen
              │ (RAM-only, ADR-004)        │   ┌────────────▼───────────────┐
              └────────────────────────────┘   │ GNOME Secrets              │
                                               │ (bleibt offen/unlocked)    │
                                               └────────────────────────────┘
```

## Warum eigenes Projekt statt [Tusk](https://github.com/subdavis/Tusk)?

Tusk deckt viel ab, aber: (1) weitgehend eingeschlafen (kaum Development seit ~2021),
(2) träge (Argon2/KDF im UI-Thread), (3) schwaches Auto-Fill (iframe-Injection),
(4) neue Einträge lassen sich nicht sauber zurück in die Cloud syncen. Dazu kommt
unser Kernwunsch: **GNOME Secrets parallel nutzen** → gemeinsam genutzte `.kdbx`
statt Insellösung. Und: eigener Dropbox-App-Key = eigenes API-Limit statt Tusk-Community-Key.

## Keys-Policy

**Kein Secret in diesem Repo.** Dropbox App-Key/-Secret und das Test-DB-Passwort
liegen verschlüsselt in `~/workspace/nixos-configuration/secrets/dropbox-keychain-env.age`
(agenix, Empfänger: `lannitz`). Der Build liest sie aus der entschlüsselten Env
(siehe `docs/ARCHITECTURE.md`, ADR-007). Auch **keine `.kdbx`** wird hier committed —
auch keine Test-DB (Passwort in agenix, Datei liegt nur lokal + Dropbox).

## Repo-Layout

```
docs/ARCHITECTURE.md   ADRs (Entscheidungen + Begründungen), Threat-Modell
docs/ROADMAP.md        Die festgelegte Reihenfolge (Phase 0–6) mit Akzeptanzkriterien
packages/core          KDBX-Domänenlogik (isomorph: Worker, Event-Page, Node-Tests)
packages/extension     Extension-Code: Manifest-Templates (chrome/firefox), Popup, Background
scripts/               Helfer (z. B. dropbox-authorize.sh für den interaktiven OAuth)
```

## Status

Phase 0 (Fundament) — Details und nächste Schritte: [`docs/ROADMAP.md`](docs/ROADMAP.md).
