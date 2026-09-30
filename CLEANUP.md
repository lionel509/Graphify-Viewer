# Cleanup — Graphify Viewer

Everything this repo generates while you work on it, and how to put the working tree
back the way a fresh `git clone` would leave it. Companion to the `.gitignore`
coverage added in #1.

Nothing here touches files git tracks. `main.js`, `package-lock.json`, the source and
the docs all stay.

## What this project leaves behind

| path / thing | created by | size note |
|---|---|---|
| `node_modules/` | `npm ci` (or `npm install`) | ~40–80 MB — esbuild, typescript, obsidian typings |
| `graphify-out/` | `graphify update .` in this folder | grows with the repo being graphed |
| `/*— Project Hub.md` | Obsidian vault note, this folder doubles as a note folder | one file |
| `__pycache__/`, `*.pyc` | running `export_obsidian.py` | a few hundred KB |
| `.pytest_cache/`, `.mypy_cache/`, `.ruff_cache/`, `.coverage` | test/lint/typecheck passes on the exporter | a few MB |
| `.venv/`, `venv/` | any local virtualenv for the exporter | ~20–30 MB (stdlib-only exporter, so you may never make one) |
| `.env`, `.env.*` | you, by hand | tiny — **kept on purpose**, see Secrets |
| `*.log`, `logs/` | redirected output while rebuilding | unbounded, safe to drop |
| `.DS_Store`, `.idea/`, `.vscode/`, `*.swp` | Finder / editors | tiny |

Build output is **not** ignored: `main.js` is committed on purpose — the README's
"Build and install" section says so, because a user installs the plugin by copying
those three files, not by running npm.

## Preview

Lists every ignored file the clean below would remove, keeping your secrets:

```bash
git clean -ndX -e '!.env' -e '!.env.*'
```

## Clean the repo

```bash
git clean -fdX -e '!.env' -e '!.env.*'
```

That is all `git clean` can see. The one thing it cannot see: **the vault copies.**
`npm run install-local` runs `install.mjs`, which copies `main.js`, `manifest.json`
and `styles.css` into `<vault>/.obsidian/plugins/graphify-viewer/` — outside the repo,
in `~/Documents`. To undo an install from a vault you control:

```bash
rm -rf ~/Documents/<Vault>/.obsidian/plugins/graphify-viewer
```

Then reload Obsidian and the plugin disappears from Community Plugins. Only do this
for vaults you installed into yourself; the plugin folder holds no vault data.

After a clean, restore dependencies with `npm ci` (exact, from `package-lock.json`)
and rebuild with `npm run build`.

## Outside the repo

| thing | exact command | shared? |
|---|---|---|
| npm's download cache, filled by `npm ci` | `npm cache clean --force` | **shared — every Node project on this Mac uses it.** Only worth it if you want the disk back; it costs a re-download next time. |
| The vault plugin folders listed above | `rm -rf ~/Documents/<Vault>/.obsidian/plugins/graphify-viewer` | per-vault, manual, optional. |
| The note export from `export_obsidian.py --out <folder>` | delete that folder by hand — the README warns `--out` is wiped and rewritten on every run, so it holds nothing else | lives inside a vault, outside the repo. Never delete it from here. |

Nothing else. The exporter is pure stdlib (no pip installs, no `~/.cache`,
no Hugging Face / torch weights, no Playwright browsers, no Docker images, no launchd
plists), and `graphify update` does local AST parsing with no network call.

## Secrets

`.env`, `.env.*`, `*.key`, `*.pem`, `credentials.json` and `secrets.json` are ignored
**and deliberately kept** by both commands above — the `-e '!.env' -e '!.env.*'`
exceptions mean `git clean` skips them. Your local secrets survive a cleanup.

This repo does not need any secret today: `export_obsidian.py` takes only file paths,
the plugin talks to no network, and `graphify update` is offline.

If you truly mean to get rid of a secret file, remove it yourself and mean it:

```bash
rm -f .env .env.*
```

If a secret was ever *committed*, deleting the file is not enough — it is in history.
Open an issue and rotate the credential first; never rewrite published history.
