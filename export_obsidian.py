"""Turn a graphify graph.json into real Obsidian notes.

graphify has no Obsidian export of its own (checked against 0.9.32), so this
writes one note per graph node, wikilinked to its neighbours and filed under a
hub note per community. The point is that Obsidian's *own* graph view, search,
and backlinks then work on the code graph — communities show up as branches off
the project hub, exactly like hand-written notes.

    python3 export_obsidian.py <graph.json> --out <vault-folder> [--vault-root <dir>]

Everything under --out is regenerated on each run, so keep it a folder that
holds nothing else. Nothing outside --out is ever touched.
"""

from __future__ import annotations

import argparse
import json
import re
import shutil
from collections import defaultdict
from pathlib import Path

# Docstring nodes are folded into the note for the thing they describe rather
# than becoming notes of their own — they are commentary, not entities.
RATIONALE = "rationale"

# Reverse edges are keyed "<relation>_by", so these must match that exactly.
RELATION_HEADINGS = {
    "calls": "Calls",
    "calls_by": "Called by",
    "contains": "Contains",
    "contains_by": "Defined in",
    "imports": "Imports",
    "imports_by": "Imported by",
    "imports_from": "Imports from",
    "imports_from_by": "Imported from by",
    "references": "References",
    "references_by": "Referenced by",
    "uses": "Uses",
    "uses_by": "Used by",
    "inherits": "Inherits",
    "inherits_by": "Inherited by",
    "method": "Methods",
    "method_by": "Method of",
    "extends": "Extends",
    "extends_by": "Extended by",
}

ILLEGAL = re.compile(r'[\\/:*?"<>|#^\[\]]')


def safe_name(text: str, fallback: str) -> str:
    """A filename Obsidian will accept, and that still reads like the label."""
    cleaned = ILLEGAL.sub("-", text or "").replace("\n", " ").strip().strip(".")
    cleaned = re.sub(r"\s+", " ", cleaned)
    if len(cleaned) > 90:
        cleaned = cleaned[:90].rstrip()
    return cleaned or fallback


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("graph", type=Path, help="path to graph.json")
    parser.add_argument("--out", type=Path, required=True, help="folder to regenerate")
    parser.add_argument(
        "--vault-root",
        type=Path,
        default=None,
        help="the vault folder, so generated notes can link into real notes instead of shadowing them",
    )
    parser.add_argument(
        "--source-root",
        default="",
        help="vault-relative folder the graph's source_file paths hang off (e.g. 'Active/Reel Analyzer MCP')",
    )
    parser.add_argument(
        "--anchor",
        default="",
        help="an existing note every group links up to, so the graph joins your vault instead of floating",
    )
    parser.add_argument("--title", default="Code Graph", help="name of the root hub note")
    args = parser.parse_args()

    graph = json.loads(args.graph.read_text())
    nodes = {n["id"]: n for n in graph["nodes"]}
    links = graph.get("links", [])

    # Fold docstrings into the node they explain.
    rationale_for: dict[str, list[str]] = defaultdict(list)
    for link in links:
        if link.get("relation") == "rationale_for":
            source = nodes.get(link["source"])
            if source and source.get("file_type") == RATIONALE:
                rationale_for[link["target"]].append(str(source.get("label", "")).strip())

    # Notes that already exist in the vault. Two jobs: a graph node standing for a
    # real note must LINK to it rather than shadow it, and no generated title may
    # collide with a real one — Obsidian resolves [[wikilinks]] by basename, so a
    # duplicate name silently hijacks links written in the user's own notes.
    vault_stems: set[str] = set()
    real_note_for: dict[str, str] = {}
    if args.vault_root:
        out_resolved = args.out.resolve()
        for path in args.vault_root.rglob("*.md"):
            if out_resolved in path.resolve().parents:
                continue
            if any(p in {".git", ".trash", "node_modules"} for p in path.parts):
                continue
            vault_stems.add(path.stem)
            rel = path.relative_to(args.vault_root).as_posix()
            prefix = f"{args.source_root}/" if args.source_root else ""
            if rel.startswith(prefix):
                real_note_for[rel[len(prefix):]] = path.stem

    def is_the_file_itself(node: dict) -> bool:
        """True when this node stands for a whole markdown file, not a section of one."""
        source = node.get("source_file") or ""
        if not source.endswith(".md") or source not in real_note_for:
            return False
        label = safe_name(str(node.get("label") or ""), "")
        return label in {real_note_for[source], f"{real_note_for[source]}.md"}

    # Nodes that map onto a real note are not written; links point at the real thing.
    aliases: dict[str, str] = {}
    kept: dict[str, dict] = {}
    for nid, node in nodes.items():
        if node.get("file_type") == RATIONALE:
            continue
        if is_the_file_itself(node):
            aliases[nid] = real_note_for[node["source_file"]]
        else:
            kept[nid] = node

    # Unique, stable note titles that also avoid every existing vault note.
    titles: dict[str, str] = {}
    used: dict[str, int] = {stem.lower(): 1 for stem in vault_stems}
    for nid, node in kept.items():
        base = safe_name(str(node.get("label") or nid), nid)
        count = used.get(base.lower(), 0)
        used[base.lower()] = count + 1
        titles[nid] = base if count == 0 else f"{base} ({count + 1})"
    titles.update(aliases)

    # Neighbours by relation, both directions.
    neighbours: dict[str, dict[str, list[str]]] = defaultdict(lambda: defaultdict(list))
    for link in links:
        source, target = link.get("source"), link.get("target")
        relation = link.get("relation") or "related"
        # `titles` covers both generated notes and aliases onto real vault notes,
        # so an edge into a real note survives and becomes a link to the real thing.
        if relation == "rationale_for" or source not in titles or target not in titles:
            continue
        neighbours[source][relation].append(target)
        neighbours[target][f"{relation}_by"].append(source)

    communities: dict[tuple, list[str]] = defaultdict(list)
    for nid, node in kept.items():
        communities[(node.get("community"), node.get("community_name") or "Ungrouped")].append(nid)

    if args.out.exists():
        shutil.rmtree(args.out)
    args.out.mkdir(parents=True)

    # graphify names each community after its most central node, so a bare name
    # would almost always collide with one of its own members. Prefix instead —
    # it disambiguates every case at once and sorts the groups together.
    # Two communities can carry the same name — graphify names each after its most
    # central node, and that node's label is not unique across the graph. Without
    # this, both would land in one folder and one hub would silently overwrite the
    # other, losing a whole group.
    community_titles: dict[tuple, str] = {}
    seen_groups: dict[str, int] = {}
    for key in sorted(communities, key=lambda k: (k[0] is None, k[0])):
        base = safe_name(
            f"Group — {str(key[1]).removesuffix('.md')}", f"Group — {key[0]}"
        )
        count = seen_groups.get(base.lower(), 0)
        seen_groups[base.lower()] = count + 1
        community_titles[key] = base if count == 0 else f"{base} ({key[0]})"

    written = 0
    for key, members in sorted(communities.items(), key=lambda kv: -len(kv[1])):
        group_title = community_titles[key]
        folder = args.out / safe_name(group_title, f"community-{key[0]}")
        folder.mkdir(parents=True, exist_ok=True)

        for nid in members:
            node = kept[nid]
            lines = [
                "---",
                "tags:",
                "  - projects",
                "  - code-graph",
                f"  - {node.get('file_type') or 'node'}",
                f"community: {key[0]}",
            ]
            if node.get("source_file"):
                lines.append(f"source_file: \"{node['source_file']}\"")
            if node.get("source_location"):
                lines.append(f"source_location: {node['source_location']}")
            lines += ["---", "", f"# {titles[nid]}", ""]

            why = [w for w in rationale_for.get(nid, []) if w]
            if why:
                lines += ["> [!quote] Why it exists", *(f"> {w}" for w in why), ""]

            location = node.get("source_file") or ""
            if location:
                where = f"`{location}`"
                if node.get("source_location"):
                    where += f" {node['source_location']}"
                lines += [f"**Defined in:** {where}", ""]
                # When the source is a note you actually wrote, link to it — this is
                # what stitches the generated cluster into the real vault graph.
                if location in real_note_for:
                    lines += [f"**In note:** [[{real_note_for[location]}]]", ""]

            lines += [f"**Group:** [[{group_title}]]", ""]

            for relation in sorted(neighbours.get(nid, {})):
                targets = sorted({titles[t] for t in neighbours[nid][relation] if t in titles})
                if not targets:
                    continue
                heading = RELATION_HEADINGS.get(relation, relation.replace("_", " ").title())
                lines.append(f"## {heading}")
                lines += [f"- [[{t}]]" for t in targets]
                lines.append("")

            (folder / f"{titles[nid]}.md").write_text("\n".join(lines))
            written += 1

        # The community hub — this is the "branch" node in Obsidian's graph view.
        hub = [
            "---",
            "tags:",
            "  - projects",
            "  - code-graph",
            "  - moc",
            f"community: {key[0]}",
            "---",
            "",
            f"# {group_title}",
            "",
            f"{len(members)} nodes. Part of [[{args.title}]].",
            "",
        ]
        if args.anchor:
            hub += [f"Project: [[{args.anchor}]]", ""]
        by_type: dict[str, list[str]] = defaultdict(list)
        for nid in members:
            by_type[kept[nid].get("file_type") or "other"].append(titles[nid])
        for file_type in sorted(by_type):
            hub.append(f"## {file_type.capitalize()}")
            hub += [f"- [[{t}]]" for t in sorted(by_type[file_type])]
            hub.append("")
        (folder / f"{group_title}.md").write_text("\n".join(hub))
        written += 1

    root = [
        "---",
        "tags:",
        "  - projects",
        "  - code-graph",
        "  - hub",
        "---",
        "",
        f"# {args.title}",
        "",
        f"Generated from `{args.graph.name}` — {len(kept)} nodes across {len(communities)} groups. ",
        "Regenerated wholesale on each export; do not hand-edit anything in this folder.",
        "",
    ]
    if args.anchor:
        root += [f"Project: [[{args.anchor}]]", ""]
    if aliases:
        root += [
            f"{len(aliases)} nodes stand for notes that already exist in the vault; "
            "those link to the real note rather than being duplicated here.",
            "",
        ]
    root.append("## Groups")
    for key, members in sorted(communities.items(), key=lambda kv: -len(kv[1])):
        root.append(f"- [[{community_titles[key]}]] — {len(members)} nodes")
    root += ["", "Hub: [[Home]]", ""]
    (args.out / f"{args.title}.md").write_text("\n".join(root))
    written += 1

    folded = len(nodes) - len(kept) - len(aliases)
    print(f"wrote {written} notes to {args.out}")
    print(f"  {len(communities)} groups, {len(kept)} nodes")
    print(f"  {folded} docstring nodes folded into their targets")
    print(f"  {len(aliases)} nodes linked to existing vault notes instead of duplicated")


if __name__ == "__main__":
    main()
