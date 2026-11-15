# Code-Tab für Agentic OS

Ein Add-on für [Agentic OS](https://github.com/sebaskauf/agentic-os) von Sebastian Kauffmann: eine eigene Obsidian-Ansicht **„Code“**, in der Claude Code in Tabs läuft, mit einer Statusleiste für alles, was man beim Arbeiten im Blick haben will.

## Was drin ist
- **Tabs:** mehrere Claude-Code-Terminals, per Ziehen sortieren, Rechtsklick zum Umbenennen und Schließen, optionales Thema im Titel („Ordner - Thema“)
- **Ordner-Browser:** neuen Tab direkt in einem beliebigen Ordner starten (Tastatur: ↑/↓, Enter, Cmd/Strg+Enter)
- **Statusleiste:**
  - PLAN: Abo und Details
  - MODEL, MODE, EFFORT: umschalten per Auswahl
  - CTX: Context-Window, mit Session-Handoff
  - TOK: Plan-Nutzung im 5-Stunden-Fenster und in der Woche
  - CLAUDE: laufende Version, Hinweis und Update per Klick
  - Git: Branch, ahead/behind, Änderungen; Panel mit Pull, Branch-Wechsel, letzten Commits (Diff, Revert, Zurücksetzen nur ungepushter Commits) und „Committen & pushen“ über Claude
- **Session-Handoff:** Übergabe-Dateien in `<Projekt>/Handoff/` schreiben und laden (nutzt das Claude-Code-Plugin `session-handoff`; fehlt es, bietet der Tab die Installation an)
- **Hell/Dunkel:** automatisch wie Obsidian oder fest, umschaltbar oben in der Ansicht

Sebastians Dashboard, der Chat-Drawer und alle anderen Tabs bleiben unverändert. Der Code-Tab hat eigene Dateien (`~/.agentic-os/code-tabs.json`, `~/.agentic-os/code-tab.json`).

**Sicherheit:** Neue Tabs starten ohne `--dangerously-skip-permissions`. Der Bypass-Modus lässt sich pro Tab bewusst einschalten (MODE → bypass).

## Nur von hier installieren
Die echte Quelle ist allein dieses Repo: https://github.com/Oliver-Richter/agentic-os-code-tab

Der Einbau führt Skripte mit deinen Rechten aus, und der Code-Tab startet Claude Code auf deinem Rechner. Installiere deshalb nicht aus Kopien (Forks), Zip-Dateien oder Links von anderen Stellen, außer du hast deren Code selbst geprüft. Fehler und Auffälligkeiten bitte hier als Issue melden.

## Einbauen
Voraussetzungen: Agentic OS im Vault, Node.js LTS, git, Python 3.

Am einfachsten lässt du Claude den Einbau machen:

> Bau mir den Code-Tab ein: lies `agentic-os-tab/EINBAU.md` in diesem Repo und folge der Anleitung.

Von Hand:
```
python3 agentic-os-tab/einbauen.py --pruefen     # nur prüfen
python3 agentic-os-tab/einbauen.py               # einbauen bzw. aktualisieren
```
Danach Obsidian neu laden und das Ribbon-Symbol `</>` oder den Befehl „Open Code“ nutzen.

Das Skript arbeitet wie die anderen Agentic-OS-Add-ons: Es baut im Quellordner (Standard `~/Documents/Projects/agentic-os`), sichert `main.js` im Vault und bricht ab, wenn ein Build andere eingebaute Tabs wegnehmen würde.

## Statuszeile
Die Pills TOK, CLAUDE und TIME brauchen Werte aus der Claude-Code-Statuszeile. `einbauen.py` legt dafür `~/.agentic-os/code-tab-statusline.js` ab und trägt es ein, wenn noch keine Statuszeile gesetzt ist. Hast du schon eine eigene, zeigt das Skript die Zeile, mit der beide zusammen laufen (`--danach "<deine bisherige>"`).

## Für Sebastian
Wenn du magst, nimm den Code-Tab in deine Liste der Agentic-OS-Add-ons auf. Aufbau und Einbau folgen deinem `agentic-os-tab`-Muster (`EINBAU.md`, `einbauen.py`, Exit-Codes 0/1/2).

## Lizenz
MIT, siehe [LICENSE](LICENSE). Teile des Codes sind aus Agentic OS (MIT, © Sebastian Kauffmann) übernommen und angepasst.
