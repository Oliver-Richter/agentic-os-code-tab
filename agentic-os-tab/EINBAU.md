# Code-Tab ins Agentic OS einbauen

Diese Anleitung ist für Claude, nicht für den Nutzer. Sie baut den Code-Tab in ein bestehendes Agentic OS ein. Das ist eine eigene Obsidian-Ansicht „Code“ mit:
- Claude-Code-Terminals in Tabs (ziehen zum Sortieren, Rechtsklick für Umbenennen und Schließen, Thema im Tab-Titel)
- Ordner-Browser für neue Tabs
- Statusleiste mit Plan, Modell, Modus, Effort, Context, Plan-Nutzung, Claude-Version mit Update und Git (Sync, Branches, Commits)
- Session-Handoff
- Hell-/Dunkel-Schema

Er läuft auf macOS, Windows und Linux. Sebastians Dashboard, der Chat-Drawer und alle anderen Tabs bleiben unverändert.

Alles Feste erledigt `einbauen.py` (nur Python-Standardbibliothek). Du entscheidest nur, wo der Nutzer gefragt werden muss.

## Ablauf

1. **Prüfen, ändert nichts:**
   ```
   python3 <repo>/agentic-os-tab/einbauen.py --pruefen
   ```
   - Unter Windows heißt der Aufruf `py -3` bzw. `python` statt `python3`.
   - Gezeigt werden: Vault, Plugin-Version, vorhandene Tabs, git, node, npm, Tabs, die im Quellcode fehlen, und der Stand der Claude-Code-Statuszeile.
   - Fehlt Node: Der Nutzer installiert Node LTS von nodejs.org (Windows: `winget install -e --id OpenJS.NodeJS.LTS`). Danach neu prüfen.
2. **Vor dem Einbau dem Nutzer sagen:**
   - Obsidian muss danach einmal neu laden.
   - Dabei schließen sich alle offenen Agentic-OS-Terminals.
   - Läuft diese Sitzung selbst in so einem Terminal, endet sie beim Neuladen. Das ist der letzte Schritt.
   - Hat er noch keine Statuszeile in Claude Code, trägt das Skript eine ein (`~/.claude/settings.json`, vorher gesichert).
   - Erst nach seinem Ja weiter.
3. **Einbauen:**
   ```
   python3 <repo>/agentic-os-tab/einbauen.py [--vault <pfad>] [--quelle <ordner>]
   ```

   | Code | Bedeutung | Was du tust |
   |---|---|---|
   | 0 | Fertig (auch: Update eines schon eingebauten Code-Tabs) | Weiter mit Schritt 4 |
   | 2 | Der Nutzer muss entscheiden | Text vorlesen, fragen, dann noch einmal aufrufen |
   | 1 | Fehler | Genaue Meldung zeigen. Am Vault nichts selbst reparieren. Code-Änderungen im Quellordner sind erlaubt (Abschnitt „Von Hand“) |

   Fälle bei Code 2:
   - **Mehrere Vaults:** fragen welcher, dann mit `--vault`.
   - **Fremde Tabs fehlen im Quellcode:** Das Plugin im Vault hat Tabs, die im Quellordner (Standard `~/Documents/Projects/agentic-os`) nicht eingebaut sind. Ein Build würde sie löschen. Erst deren EINBAU.md im selben Quellordner nachholen, dann noch einmal aufrufen.
   - **Version:** Das Plugin im Vault ist neuer als der Quellcode. Nicht bauen, erst den Quellordner aktualisieren.
4. **Statuszeile:** Meldet das Skript „Du hast schon eine eigene statusLine“, dem Nutzer die ausgegebene Zeile zeigen und fragen, ob du sie eintragen sollst. Ohne sie bleiben die Pills TOK, CLAUDE und TIME leer, alles andere geht.
5. **Neu laden lassen:**
   - Der Nutzer lädt Obsidian neu. Mac: Cmd+R, Windows: Strg+R, oder in der Befehlspalette „Reload app without saving“.
   - Danach: Ribbon-Symbol `</>` oder Befehl „Open Code“. Einstellungen (Start-Ordner, Farbschema): Zahnrad oben in der Ansicht oder Befehl „Code-Tab: Einstellungen“.
6. **Zurück, falls etwas nicht stimmt:**
   - Im Plugin-Ordner liegt `main.js.bak-vor-code-tab-<zeit>`. Wieder in `main.js` umbenennen und neu laden.
   - Die Statuszeile: `settings.json.bak-vor-code-tab-<zeit>` neben `~/.claude/settings.json` zurückkopieren.

## Von Hand, wenn das Skript an main.ts scheitert
Der Quellcode des Agentic OS gehört dem Nutzer, Anpassen ist erlaubt. Von Hand tabu sind nur die Dateien im Vault (`main.js` dort). Die schreibt immer `einbauen.py`, mit Sicherung und Prüfung.
Meldet `einbauen.py` „src/main.ts sieht anders aus als erwartet“, baue die zwei Stellen in `src/main.ts` selbst ein. Such sie über den Inhalt, nicht über Zeilennummern:
1. Nach der letzten Import-Zeile: `import { registerCodeTab } from "./codeTab/register";`
2. Als erste Zeile in `onload()` der Plugin-Klasse: `registerCodeTab(this);`

Dann `einbauen.py` noch einmal starten. Es erkennt die fertigen Stellen, baut, prüft und kopiert.

## Was das Skript ändert
- **Im Quellordner (bei Bedarf geklont):**
  - neu: `src/codeTab/` (Kopie von `codeTab/`, dazu `codeTabCss.ts`, aus `code-tab.css` erzeugt)
  - `src/main.ts` an zwei Stellen, Sicherung `main.ts.vor-code-tab` daneben
  - gebaut wird mit `npm install --ignore-scripts`, `tsc` und `esbuild`. node-pty bleibt extern, die Binaries im Vault bleiben.
- **Im Vault:** nur `main.js`, vorher gesichert. `styles.css` und `manifest.json` bleiben, das CSS des Code-Tabs steckt im Bundle.
- **Im Home-Ordner:**
  - `~/.agentic-os/code-tab-statusline.js` (Statuszeile; schreibt in Code-Tabs `~/.agentic-os/statusline/<tab>.json`)
  - nur ohne eigene Statuszeile: Eintrag `statusLine` in `~/.claude/settings.json`
  - zur Laufzeit: `~/.agentic-os/code-tabs.json` (Tabs), `~/.agentic-os/code-tab.json` (Einstellungen)
