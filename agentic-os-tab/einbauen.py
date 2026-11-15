"""Code-Tab (Claude Code in Tabs, Statusleiste, Git, Handoff) in ein bestehendes Agentic OS einbauen.
macOS, Windows, Linux; nur Python-Standardbibliothek. Aufbau wie die agentic-os-tab-Add-ons von Sebastian Kauffmann.

Was passiert:
  - baut auf dem Quellordner auf, aus dem auch andere Tabs schon eingebaut wurden, und bricht ab, wenn das
    installierte Plugin Tabs hat, die im Quellcode fehlen (ein Build würde sie sonst wegnehmen)
  - legt src/codeTab/ an (Kopie von codeTab/ + codeTabCss.ts aus code-tab.css) und ändert src/main.ts an zwei
    Stellen (Import, ein Aufruf in onload); App.tsx und alle anderen Dateien bleiben unverändert
  - sichert main.js im Vault und prüft das neue Bundle (alle alten Tabs + Kennung drin)
  - Statuszeile: legt ~/.agentic-os/code-tab-statusline.js ab und trägt sie in die Claude-Code-Einstellungen ein,
    aber nur wenn dort noch keine statusLine steht; sonst nur Anleitung

Aufruf (Claude führt das aus, siehe EINBAU.md):
  python3 einbauen.py --pruefen                    nur prüfen, ändert nichts
  python3 einbauen.py [--vault <pfad>]             einbauen bzw. aktualisieren
  Optionen: --quelle <ordner> (Standard ~/Documents/Projects/agentic-os), --trocken (bauen, nicht kopieren),
            --ohne-statuszeile (Claude-Code-Einstellungen nicht anfassen)
Exit-Codes: 0 fertig · 2 Nutzer muss entscheiden (mehrere Vaults, fremde Tabs, Version) · 1 Fehler."""
from __future__ import annotations

import argparse
import json
import os
import platform
import re
import shutil
import subprocess
import sys
from datetime import datetime
from pathlib import Path

HIER = Path(__file__).resolve().parent
REPO_URL = 'https://github.com/sebaskauf/agentic-os.git'
KENNUNG = 'agentic-os-code-tab'
WIN = platform.system() == 'Windows'
TAB_RE = re.compile(r'\[\s*"([A-Z][A-Z0-9_]{1,20})"\s*,\s*"[^"\]]{1,24}"\s*\]')
IMPORT_ZEILE = 'import { registerCodeTab } from "./codeTab/register";'
AUFRUF_ZEILE = 'registerCodeTab(this);'
STATUSZEILE_NAME = 'code-tab-statusline.js'


def sag(text: str) -> None:
    print(text, flush=True)


def raus(code: int, text: str) -> None:
    sag(('FEHLER: ' if code == 1 else 'ENTSCHEIDUNG: ' if code == 2 else '') + text)
    sys.exit(code)


def obsidian_json() -> Path:
    if platform.system() == 'Darwin':
        return Path.home() / 'Library/Application Support/obsidian/obsidian.json'
    if WIN:
        return Path(os.environ.get('APPDATA', Path.home() / 'AppData/Roaming')) / 'obsidian/obsidian.json'
    return Path(os.environ.get('XDG_CONFIG_HOME', Path.home() / '.config')) / 'obsidian/obsidian.json'


def vaults_mit_agentic_os() -> list[Path]:
    try:
        d = json.loads(obsidian_json().read_text(encoding='utf-8'))
    except (OSError, ValueError):
        return []
    aus = []
    for v in (d.get('vaults') or {}).values():
        pfad = Path(str(v.get('path') or ''))
        if (pfad / '.obsidian/plugins/agentic-os/manifest.json').is_file():
            aus.append(pfad)
    return aus


def version(p: Path) -> tuple[int, ...]:
    try:
        v = json.loads(p.read_text(encoding='utf-8')).get('version') or '0'
    except (OSError, ValueError):
        v = '0'
    return tuple(int(x) for x in re.findall(r'\d+', v)[:3]) or (0,)


def tabs_im_bundle(main_js: str) -> set[str]:
    """Tab-IDs aus dem gebauten Bundle: die TABS-Liste bleibt beim Minifizieren als [["OVERVIEW","…"],…] stehen."""
    m = re.search(r'\[\s*(\[\s*"OVERVIEW"\s*,\s*"[^"]*"\s*\](?:\s*,\s*\[\s*"[A-Z0-9_]+"\s*,\s*"[^"]*"\s*\])*)\s*,?\s*\]', main_js)
    return {x.group(1) for x in TAB_RE.finditer(m.group(1))} if m else set()


def tabs_im_quellcode(app: str) -> set[str]:
    m = re.search(r'TABS[^=]*=\s*\[(.*?)\];', app, re.S)
    return {x.group(1) for x in TAB_RE.finditer(m.group(1))} if m else set()


def main_ts_patchen(text: str) -> str:
    """Zwei Stellen in src/main.ts: Import nach dem letzten Import, Aufruf als erste Zeile von onload()."""
    if IMPORT_ZEILE not in text:
        importe = list(re.finditer(r'^import .*?;$', text, re.M | re.S))
        if not importe:
            raus(1, 'src/main.ts sieht anders aus als erwartet: keine import-Zeilen gefunden. Von Hand einbauen (EINBAU.md, Abschnitt „Von Hand“).')
        ende = importe[-1].end()
        text = text[:ende] + '\n' + IMPORT_ZEILE + text[ende:]
    if AUFRUF_ZEILE not in text:
        treffer = list(re.finditer(r'(async\s+)?onload\s*\(\s*\)\s*(:\s*Promise<void>\s*)?\{[ \t]*\n', text))
        if len(treffer) != 1:
            raus(1, 'src/main.ts sieht anders aus als erwartet: onload() nicht eindeutig gefunden. Von Hand einbauen (EINBAU.md, Abschnitt „Von Hand“).')
        ende = treffer[0].end()
        text = text[:ende] + '\t\t' + AUFRUF_ZEILE + '\n' + text[ende:]
    return text


def befehl(args: list[str], cwd: Path) -> subprocess.CompletedProcess:
    exe = shutil.which(args[0] + ('.cmd' if WIN and args[0] in ('npm', 'npx') else '')) or shutil.which(args[0])
    if not exe:
        raus(1, f'{args[0]} fehlt. ' + ('Node.js (LTS) von nodejs.org installieren.' if args[0] in ('node', 'npm', 'npx') else
                                     'Git installieren (Mac: xcode-select --install, Windows: winget install -e --id Git.Git).'))
    sag(f'> {" ".join(args)}')
    return subprocess.run([exe, *args[1:]], cwd=str(cwd), capture_output=True, text=True, encoding='utf-8', errors='replace')


def eigenen_patch_zuruecksetzen(quelle: Path) -> None:
    """Vor git pull: Ist main.ts genau Git-Stand + unser Patch, wird main.ts (und das gebaute main.js) zurückgesetzt,
    damit pull nicht an „lokalen Änderungen“ scheitert. Fremde Änderungen bleiben immer unangetastet."""
    r = subprocess.run(['git', 'status', '--porcelain'], cwd=str(quelle), capture_output=True, text=True, encoding='utf-8', errors='replace')
    if r.returncode or not r.stdout.strip():
        return
    geaendert = {z[3:].strip().rstrip('/') for z in r.stdout.splitlines() if z.strip()}
    if not geaendert <= {'src/main.ts', 'src/codeTab', 'main.js', 'src/main.ts.vor-code-tab', 'build-code-tab'} or 'src/main.ts' not in geaendert:
        return
    kopf = subprocess.run(['git', 'show', 'HEAD:src/main.ts'], cwd=str(quelle), capture_output=True, text=True, encoding='utf-8')
    if kopf.returncode or main_ts_patchen(kopf.stdout) != (quelle / 'src/main.ts').read_text(encoding='utf-8'):
        sag('Hinweis: src/main.ts enthält Änderungen außer dem Code-Tab. Ich setze nichts zurück.')
        return
    subprocess.run(['git', 'checkout', '--', 'src/main.ts', 'main.js'], cwd=str(quelle), capture_output=True, text=True)
    sag('Eigenen Code-Tab-Patch vom letzten Einbau zurückgesetzt, damit git pull geht. Er wird gleich neu eingebaut.')


def claude_dir() -> Path:
    return Path(os.environ.get('CLAUDE_CONFIG_DIR') or Path.home() / '.claude')


def statuszeile(pruefen: bool) -> None:
    """Statuszeilen-Skript ablegen und nur dann eintragen, wenn noch keine statusLine konfiguriert ist."""
    ziel = Path.home() / '.agentic-os' / STATUSZEILE_NAME
    kommando = f'node "{ziel}"'
    settings = claude_dir() / 'settings.json'
    try:
        daten = json.loads(settings.read_text(encoding='utf-8')) if settings.is_file() else {}
    except (OSError, ValueError) as e:
        sag(f'Statuszeile: {settings} nicht lesbar ({e}). Nichts geändert. Die Pills TOK/CLAUDE bleiben leer, bis die Datei lesbar ist.')
        return
    vorhanden = (daten.get('statusLine') or {}).get('command') if isinstance(daten.get('statusLine'), dict) else None
    if pruefen:
        sag(f'Statuszeile: {"keine gesetzt, wird eingetragen" if not vorhanden else ("schon die vom Code-Tab" if STATUSZEILE_NAME in vorhanden else "eigene vorhanden: " + vorhanden)}')
        return
    ziel.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(HIER / STATUSZEILE_NAME, ziel)
    if vorhanden and STATUSZEILE_NAME in vorhanden:
        sag(f'Statuszeile: schon eingetragen, Skript aktualisiert ({ziel}).')
        return
    if vorhanden:
        sag('Statuszeile: Du hast schon eine eigene statusLine, ich ändere sie nicht.\n'
            f'  Damit die Pills TOK, CLAUDE und TIME Werte zeigen, die Zeile in {settings} so ändern (deine bleibt außerhalb der Code-Tabs aktiv):\n'
            f'  "command": {json.dumps(kommando + " --danach " + json.dumps(vorhanden))}')
        return
    if settings.is_file():
        shutil.copy2(settings, settings.with_name(f'settings.json.bak-vor-code-tab-{datetime.now():%Y%m%d-%H%M}'))
    daten['statusLine'] = {'type': 'command', 'command': kommando}
    settings.parent.mkdir(parents=True, exist_ok=True)
    tmp = settings.with_name('settings.json.code-tab.tmp')
    tmp.write_text(json.dumps(daten, indent=2, ensure_ascii=False) + '\n', encoding='utf-8')
    os.replace(tmp, settings)
    sag(f'Statuszeile eingetragen: {kommando} (Sicherung der alten settings.json daneben).')


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--vault')
    ap.add_argument('--quelle', default=str(Path.home() / 'Documents/Projects/agentic-os'))
    ap.add_argument('--pruefen', action='store_true')
    ap.add_argument('--trocken', action='store_true')
    ap.add_argument('--ohne-statuszeile', action='store_true')
    a = ap.parse_args()

    # 1. Vault
    if a.vault:
        vault = Path(a.vault).expanduser()
        if not (vault / '.obsidian/plugins/agentic-os/manifest.json').is_file():
            raus(1, f'In {vault} liegt kein Agentic OS (.obsidian/plugins/agentic-os fehlt).')
    else:
        vs = vaults_mit_agentic_os()
        if not vs:
            raus(1, f'Kein Vault mit Agentic OS gefunden (gelesen: {obsidian_json()}). Pfad mit --vault angeben.')
        if len(vs) > 1:
            raus(2, 'Mehrere Vaults mit Agentic OS. Frag den Nutzer, welcher, und ruf mich mit --vault <pfad> auf:\n'
                 + '\n'.join(f'  {v}' for v in vs))
        vault = vs[0]
    plugin = vault / '.obsidian/plugins/agentic-os'
    main_js = (plugin / 'main.js').read_text(encoding='utf-8', errors='replace')
    v_inst = version(plugin / 'manifest.json')
    update = KENNUNG in main_js
    sag(f'Vault: {vault}\nAgentic OS im Vault: v{".".join(map(str, v_inst))}\nCode-Tab: {"schon drin, wird aktualisiert" if update else "noch nicht drin"}')
    inst_tabs = tabs_im_bundle(main_js)
    sag(f'Tabs im Vault: {", ".join(sorted(inst_tabs)) or "nicht lesbar"}')

    # 2. Quellcode
    quelle = Path(a.quelle).expanduser()
    if a.pruefen:
        for prog in ('git', 'node', 'npm'):
            sag(f'{prog}: {"ok" if shutil.which(prog) or shutil.which(prog + ".cmd") else "FEHLT"}')
        da = (quelle / 'src/main.ts').is_file()
        sag(f'Quellordner: {quelle} ({"da" if da else "wird geklont"})')
        if da and (quelle / 'src/App.tsx').is_file():
            fehlen = inst_tabs - tabs_im_quellcode((quelle / 'src/App.tsx').read_text(encoding='utf-8'))
            sag(f'Tabs, die im Quellcode fehlen: {", ".join(sorted(fehlen)) or "keine"}')
        if not a.ohne_statuszeile:
            statuszeile(pruefen=True)
        raus(0, 'Prüfung fertig, nichts geändert.')
    if not (quelle / 'src/main.ts').is_file():
        quelle.parent.mkdir(parents=True, exist_ok=True)
        r = befehl(['git', 'clone', REPO_URL, str(quelle)], quelle.parent)
        if r.returncode:
            raus(1, f'git clone ging nicht: {(r.stderr or r.stdout).strip()[-400:]}')
    else:
        eigenen_patch_zuruecksetzen(quelle)
        r = befehl(['git', 'pull', '--ff-only'], quelle)
        if r.returncode:
            sag(f'Hinweis: git pull ging nicht ({(r.stderr or r.stdout).strip()[-200:]}). Im Quellordner gibt es Änderungen, die nicht '
                'von diesem Einbau stammen. Ich lasse sie unangetastet und baue mit dem vorhandenen Stand weiter.')
    v_quelle = version(quelle / 'manifest.json')
    if v_quelle < v_inst:
        raus(2, f'Das Plugin im Vault (v{".".join(map(str, v_inst))}) ist neuer als der Quellcode (v{".".join(map(str, v_quelle))}). '
             'Ein Build daraus würde neuere Teile wegnehmen. Erst den Quellordner aktualisieren.')
    app = (quelle / 'src/App.tsx').read_text(encoding='utf-8') if (quelle / 'src/App.tsx').is_file() else ''
    fehlen = inst_tabs - tabs_im_quellcode(app)
    if fehlen:
        raus(2, f'Dein Agentic OS hat Tabs, die im Quellcode {quelle} fehlen: {", ".join(sorted(fehlen))}. '
             'Ein Build würde sie wegnehmen. Erst deren Einbau-Anleitung (EINBAU.md des jeweiligen Add-ons) im selben Quellordner '
             'nachholen, dann mich noch einmal starten. Am Vault nichts von Hand bauen.')

    # 3. Dateien + main.ts
    ziel_src = quelle / 'src/codeTab'
    if ziel_src.exists():
        shutil.rmtree(ziel_src)
    shutil.copytree(HIER / 'codeTab', ziel_src)
    css = (HIER / 'code-tab.css').read_text(encoding='utf-8')
    (ziel_src / 'codeTabCss.ts').write_text('// Generated by einbauen.py from code-tab.css. Do not edit.\n'
                                            f'export const CODE_TAB_CSS: string = {json.dumps(css)};\n', encoding='utf-8')
    main_ts = quelle / 'src/main.ts'
    alt = main_ts.read_text(encoding='utf-8')
    neu = main_ts_patchen(alt)
    if neu != alt:
        shutil.copy2(main_ts, main_ts.with_name('main.ts.vor-code-tab'))
        main_ts.write_text(neu, encoding='utf-8')
    sag('src/codeTab/ angelegt, src/main.ts angepasst.')

    # 4. Bauen (ohne native Builds: node-pty bleibt extern, das Vault hat seine eigenen Binaries)
    if not (quelle / 'node_modules/esbuild').is_dir():
        r = befehl(['npm', 'install', '--ignore-scripts', '--no-audit', '--no-fund'], quelle)
        if r.returncode:
            raus(1, f'npm install ging nicht: {(r.stderr or r.stdout).strip()[-500:]}')
    r = befehl(['npx', 'tsc', '-noEmit', '-skipLibCheck'], quelle)
    if r.returncode:
        raus(1, f'TypeScript meldet Fehler:\n{(r.stdout or r.stderr).strip()[-1500:]}')
    r = befehl(['node', 'esbuild.config.mjs', 'production'], quelle)
    if r.returncode or not (quelle / 'main.js').is_file():
        raus(1, f'Build ging nicht: {(r.stderr or r.stdout).strip()[-800:]}')
    ziel = quelle / 'build-code-tab'
    ziel.mkdir(exist_ok=True)
    shutil.copy2(quelle / 'main.js', ziel / 'main.js')
    bundle = (ziel / 'main.js').read_text(encoding='utf-8', errors='replace')

    # 5. Prüfen: Kennung + alle alten Tabs
    fehlt = inst_tabs - tabs_im_bundle(bundle)
    if KENNUNG not in bundle or fehlt:
        raus(1, f'Das neue Bundle ist unvollständig (Kennung {"da" if KENNUNG in bundle else "fehlt"}, fehlende Tabs: '
             f'{", ".join(sorted(fehlt)) or "keine"}). Nichts kopiert.')
    sag(f'Neues Bundle geprüft: Tabs {", ".join(sorted(tabs_im_bundle(bundle))) or "—"}, Kennung {KENNUNG} drin.')

    if a.trocken:
        raus(0, f'Trocken: Bundle liegt in {ziel / "main.js"}, ins Vault kopiert habe ich nichts.')

    # 6. Ins Vault (vorher sichern), dann Statuszeile
    sicherung = plugin / f'main.js.bak-vor-code-tab-{datetime.now():%Y%m%d-%H%M}'
    shutil.copy2(plugin / 'main.js', sicherung)
    shutil.copy2(ziel / 'main.js', plugin / 'main.js')
    sag(f'Eingebaut. Sicherung: {sicherung}')
    if not a.ohne_statuszeile:
        statuszeile(pruefen=False)
    sag('Jetzt Obsidian neu laden (Befehlspalette: „Reload app without saving“ bzw. Cmd/Strg+R). Dabei schließen sich offene '
        'Agentic-OS-Terminals. Danach: Ribbon-Symbol </> oder Befehl „Open Code“.')
    sag(f'Zurück auf den alten Stand: {sicherung.name} wieder in main.js umbenennen und Obsidian neu laden.')


if __name__ == '__main__':
    main()
