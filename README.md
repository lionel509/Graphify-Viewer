# Graphify Viewer

An Obsidian plugin that renders a [graphify](https://github.com/Graphify-Labs/graphify)
knowledge graph inside the vault, and opens the note or source file behind any node.

Graphify turns a folder into a queryable graph of what its code and notes actually
contain. Its own output is a standalone `graph.html` that lives outside Obsidian. This
plugin brings the graph *into* the vault, so a node is one click from the thing it
describes — which only works if your notes and your code sit in the same folder.

## What the plugin does

- **Force-directed view** of `graph.json`, drawn on canvas — pan, zoom, hover to light
  up a node's edges.
- **Click a node → opens the file**, jumping to the recorded line when graphify
  captured one.
- **Search** filters and highlights; everything else dims.
- **Colour by community** (graphify's own clustering) **or by file type** — code,
  document, rationale.
- Layout tuning — link distance, repulsion — in settings.

No external libraries. The layout is a plain spring/repulsion simulation, so the bundle
is 18 KB and nothing is fetched at runtime.

## The other half: `export_obsidian.py`

The plugin *renders* the graph. The exporter turns it into real notes instead. They
answer different questions:

| | `export_obsidian.py` | the plugin view |
|---|---|---|
| Output | one `.md` note per node, with wikilinks | a canvas rendering of `graph.json` |
| Appears in Obsidian's own graph view | ✅ groups become branches | ❌ |
| Search, backlinks, tags work on it | ✅ | ❌ |
| Reflects a rebuild automatically | ❌ re-run the export | ✅ reload the view |
| Clutters the vault | one note per node | nothing |

```bash
python3 export_obsidian.py path/to/graph.json --out "Code Graph" --title "Code Graph"
```

One note per node, filed under a hub note per community, so the graph view shows
`Code Graph` → group hubs → their members. Docstrings fold into the note for the thing
they describe rather than becoming nodes of their own, and neighbours are listed under
readable headings — Calls, Called by, Defined in, Imported by, References.

`--out` is **wiped and rewritten on every run**, so point it at a folder holding nothing
else. Deleting that folder undoes the whole thing.

Two things worth knowing:

- Two communities can share a name — graphify names each after its most central node,
  which is not unique. They are disambiguated by community id; without that, one folder
  silently swallows the other.
- Graphify's clustering is not perfectly stable between runs. Group counts drift (19 → 17
  across two runs on identical input), and names and membership shift with them, so links
  into the export are not permanent identifiers.

## Keeping it current

The plugin can run the whole chain itself — `graphify update` on the project folder, the
note export, then reloading any open view.

- **Command palette:** *Rebuild the graph and re-export notes*
- **Settings → Refresh now**
- **Settings → Rebuild when Obsidian starts** — off by default, since it rewrites the
  export folder on every launch. When on, it fires three seconds after the workspace is
  ready so it doesn't fight Obsidian's own indexing.

> **Binaries must be absolute paths.** Obsidian is launched from the GUI on macOS and
> **does not inherit the shell `PATH`**, so a bare `python3` or `graphify` may not
> resolve. Defaults are `/usr/bin/python3` (always present — the exporter is pure stdlib)
> and `~/.local/bin/graphify`. Verified under a stripped
> `PATH=/usr/bin:/bin:/usr/sbin:/sbin`.

## Build and install

`main.js` is committed, so nothing needs installing to *use* the plugin. Restore
dependencies only to rebuild:

```bash
npm ci                                    # exact restore from package-lock.json
OBSIDIAN_VAULT=/path/to/vaults npm run install-local
```

`install.mjs` copies the build into each vault it knows about. Point it somewhere else
with `OBSIDIAN_VAULT` (the folder containing your vaults) or replace the list entirely
with `OBSIDIAN_VAULTS`, a colon-separated set of vault paths. Anything that isn't an
Obsidian vault is skipped rather than treated as an error.

Then reload Obsidian and enable **Graphify Viewer** in Community Plugins.

To produce a graph for it to read:

```bash
graphify update path/to/project
```

`graphify update` is local AST parsing with no LLM call.

## Scale

Measured against a synthetic tree of 430 folders, 13 levels deep, 600 files: every file
indexed, full relative paths preserved at every depth, 2,100 nodes / 2,100 edges in 1.8
seconds. Depth is a non-issue — `source_file` is stored relative to the graph root, so a
click resolves the same way at any nesting level.

The real constraint is node count in the viewer:

| nodes | exact O(n²) | grid approximation | |
|---|---:|---:|---|
| 270 | 0.3 ms | 0.8 ms | both fine |
| 2,100 | 9.4 ms | 5.8 ms | both fine |
| 4,000 | 33.2 ms | 9.4 ms | grid needed |
| 8,000 | 134.5 ms | 20.5 ms | grid needed |
| 16,000 | 528.7 ms | 66.5 ms | grid 8× better, still heavy |

Repulsion bins nodes into a ~20×20 grid: neighbouring cells repel exactly, distant cells
act through their centre of mass. Iteration count drops on large graphs (140 ticks above
1,200 nodes, 90 above 3,000) and the label threshold rises so hubs stay readable instead
of becoming a wall of text.

One vault is comfortable. A graph merged across several is where the grid starts
mattering, and past ~16,000 nodes the honest answer is to filter the graph rather than
render all of it.

## Layout

| Path | What |
|---|---|
| `src/main.ts` | the whole plugin — view, layout, settings |
| `export_obsidian.py` | graph → notes exporter, pure stdlib |
| `manifest.json` | Obsidian plugin manifest |
| `esbuild.config.mjs` | bundler config |
| `install.mjs` | copies the build into a vault |

## Known gaps

- **Multi-graph.** Settings take one `graph.json`. Several projects means either a graph
  picker or pointing at a pre-merged graph.
- **Edge relations aren't surfaced.** The graph carries `contains` / `calls` / `imports` /
  `references` / `rationale_for`; the view draws every edge alike. Filtering by relation
  would make it far more readable past a couple hundred nodes.

## License

MIT
