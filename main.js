"use strict";
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// src/main.ts
var main_exports = {};
__export(main_exports, {
  VIEW_TYPE_GRAPHIFY: () => VIEW_TYPE_GRAPHIFY,
  default: () => GraphifyViewerPlugin
});
module.exports = __toCommonJS(main_exports);
var import_node_child_process = require("node:child_process");
var import_node_os = require("node:os");
var import_obsidian = require("obsidian");
var VIEW_TYPE_GRAPHIFY = "graphify-graph-view";
var GRAPH_SUFFIX = "graphify-out/graph.json";
var DEFAULT_SETTINGS = {
  // Blank means "find one" — the plugin is installed across several vaults and
  // a hardcoded path would be wrong in all but one of them.
  graphPath: "",
  colorBy: "community",
  showLabels: true,
  linkDistance: 45,
  chargeStrength: 260,
  // Blank means "derive it from the graph path".
  projectFolder: "",
  graphifyBin: `${(0, import_node_os.homedir)()}/.local/bin/graphify`,
  // Absolute, not "python3": Obsidian is launched from the GUI and does not
  // inherit the shell PATH, so a bare name may not resolve. /usr/bin/python3 is
  // always present on macOS and the exporter is pure stdlib.
  pythonBin: "/usr/bin/python3",
  exporterPath: `${(0, import_node_os.homedir)()}/Documents/Citadel/Active/Graphify Viewer/export_obsidian.py`,
  // Blank by default: writing 200+ generated notes into a vault should be opted
  // into per vault, not inherited from whichever vault was configured first.
  exportOut: "",
  anchorNote: "",
  refreshOnStartup: false
};
var PALETTE = [
  "#9061ff",
  "#4f9cf9",
  "#31c48d",
  "#f6a723",
  "#f36d6d",
  "#2dd4bf",
  "#e879b9",
  "#a3b18a",
  "#8b93f8",
  "#d4a373",
  "#67c2dc",
  "#c084fc",
  "#7ec97e",
  "#f2955e"
];
var FILE_TYPE_COLORS = {
  code: "#4f9cf9",
  document: "#9061ff",
  rationale: "#31c48d"
};
function colorFor(node, mode) {
  if (mode === "fileType") {
    return FILE_TYPE_COLORS[node.file_type ?? ""] ?? "#8a8a8a";
  }
  const community = node.community ?? 0;
  return PALETTE[Math.abs(community) % PALETTE.length];
}
var GraphifyView = class extends import_obsidian.ItemView {
  constructor(leaf, plugin) {
    super(leaf);
    this.plugin = plugin;
  }
  canvas;
  ctx;
  statusEl;
  nodes = [];
  links = [];
  graphRoot = "";
  scale = 1;
  offsetX = 0;
  offsetY = 0;
  hovered = null;
  query = "";
  matches = /* @__PURE__ */ new Set();
  frame = 0;
  ticks = 0;
  raf = null;
  resizeObserver = null;
  getViewType() {
    return VIEW_TYPE_GRAPHIFY;
  }
  getDisplayText() {
    return "Graphify graph";
  }
  getIcon() {
    return "git-fork";
  }
  async onOpen() {
    const container = this.contentEl;
    container.empty();
    container.addClass("graphify-view");
    const toolbar = container.createDiv({ cls: "graphify-toolbar" });
    const search = toolbar.createEl("input", {
      cls: "graphify-search",
      attr: { type: "text", placeholder: "Search nodes\u2026" }
    });
    search.addEventListener("input", () => {
      this.query = search.value.trim().toLowerCase();
      this.recomputeMatches();
      this.draw();
    });
    const reload = toolbar.createEl("button", { text: "Reload" });
    reload.addEventListener("click", () => void this.loadGraph());
    const replay = toolbar.createEl("button", { text: "Re-layout" });
    replay.addEventListener("click", () => {
      this.seed();
      this.ticks = 0;
      this.run();
    });
    const fit = toolbar.createEl("button", { text: "Fit" });
    fit.addEventListener("click", () => {
      this.fitToView();
      this.draw();
    });
    this.statusEl = toolbar.createDiv({ cls: "graphify-status" });
    const wrap = container.createDiv({ cls: "graphify-canvas-wrap" });
    this.canvas = wrap.createEl("canvas");
    const ctx = this.canvas.getContext("2d");
    if (!ctx) {
      new import_obsidian.Notice("Graphify Viewer: could not get a 2D canvas context.");
      return;
    }
    this.ctx = ctx;
    this.registerCanvasEvents();
    this.resizeObserver = new ResizeObserver(() => {
      this.resize();
      this.draw();
    });
    this.resizeObserver.observe(wrap);
    await this.loadGraph();
  }
  async onClose() {
    if (this.raf !== null) cancelAnimationFrame(this.raf);
    this.resizeObserver?.disconnect();
  }
  resize() {
    const wrap = this.canvas.parentElement;
    if (!wrap) return;
    const ratio = window.devicePixelRatio || 1;
    const width = wrap.clientWidth;
    const height = wrap.clientHeight;
    this.canvas.width = width * ratio;
    this.canvas.height = height * ratio;
    this.canvas.style.width = `${width}px`;
    this.canvas.style.height = `${height}px`;
    this.ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
  }
  /** Resolve a graph node's source_file to a vault path. */
  vaultPathFor(node) {
    if (!node.source_file) return null;
    return (0, import_obsidian.normalizePath)(this.graphRoot ? `${this.graphRoot}/${node.source_file}` : node.source_file);
  }
  /** Re-read graph.json from disk — used after an external rebuild. */
  async reload() {
    await this.loadGraph();
  }
  async loadGraph() {
    const configured = this.plugin.settings.graphPath.trim();
    let path = configured ? (0, import_obsidian.normalizePath)(configured) : "";
    let file = path ? this.app.vault.getAbstractFileByPath(path) : null;
    if (!(file instanceof import_obsidian.TFile)) {
      const found = this.plugin.findGraphs();
      if (found.length > 0) {
        path = found[0];
        file = this.app.vault.getAbstractFileByPath(path);
        if (configured) {
          new import_obsidian.Notice(`No graph at "${configured}" \u2014 using ${path} instead.`, 6e3);
        }
      }
    }
    if (!(file instanceof import_obsidian.TFile)) {
      this.status(
        "No graphify graph in this vault. Build one with `graphify update <folder>`, or set the path in Graphify Viewer settings."
      );
      this.nodes = [];
      this.links = [];
      this.draw();
      return;
    }
    const parts = path.split("/");
    this.graphRoot = parts.slice(0, Math.max(0, parts.length - 2)).join("/");
    let raw;
    try {
      raw = JSON.parse(await this.app.vault.read(file));
    } catch (error) {
      this.status(`Could not parse ${path}: ${error}`);
      return;
    }
    const byId = /* @__PURE__ */ new Map();
    this.nodes = (raw.nodes ?? []).map((n) => {
      const node = { ...n, x: 0, y: 0, vx: 0, vy: 0, degree: 0 };
      byId.set(n.id, node);
      return node;
    });
    this.links = [];
    for (const link of raw.links ?? []) {
      const source = byId.get(link.source);
      const target = byId.get(link.target);
      if (!source || !target) continue;
      source.degree++;
      target.degree++;
      this.links.push({ source, target, relation: link.relation ?? "related" });
    }
    this.seed();
    this.recomputeMatches();
    this.ticks = 0;
    this.resize();
    this.run();
  }
  status(text) {
    this.statusEl.setText(text);
  }
  seed() {
    const count = Math.max(1, this.nodes.length);
    const radius = 30 + count * 1.6;
    this.nodes.forEach((node, index) => {
      const angle = index / count * Math.PI * 2;
      const jitter = 1 + index * 37 % 11 / 20;
      node.x = Math.cos(angle) * radius * jitter;
      node.y = Math.sin(angle) * radius * jitter;
      node.vx = 0;
      node.vy = 0;
    });
    this.scale = 1;
    this.offsetX = 0;
    this.offsetY = 0;
  }
  recomputeMatches() {
    this.matches.clear();
    if (!this.query) return;
    for (const node of this.nodes) {
      const haystack = `${node.label ?? ""} ${node.source_file ?? ""} ${node.community_name ?? ""}`;
      if (haystack.toLowerCase().includes(this.query)) this.matches.add(node.id);
    }
  }
  /** One step of a spring/repulsion layout.
   *
   *  Repulsion is the expensive half. Exact pairwise is O(n²), which is fine for a
   *  couple of hundred nodes and unusable for a few thousand — a vault of 300
   *  subfolders produces ~2,100 nodes, or 4.4M pair calculations per frame.
   *  So: nodes are binned into a grid sized to hold roughly 20x20 cells. Neighbours
   *  in the surrounding cells repel exactly; everything further away is approximated
   *  by its cell's centre of mass, one force term per cell. That is Barnes-Hut in
   *  spirit, and it turns the per-node cost into (nearby nodes + occupied cells).
   */
  step() {
    const { linkDistance, chargeStrength } = this.plugin.settings;
    const nodes = this.nodes;
    const count = nodes.length;
    const cooling = Math.max(0.02, 1 - this.ticks / 400);
    const charge2 = chargeStrength * chargeStrength;
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const node of nodes) {
      if (node.x < minX) minX = node.x;
      if (node.x > maxX) maxX = node.x;
      if (node.y < minY) minY = node.y;
      if (node.y > maxY) maxY = node.y;
    }
    const spread = Math.max(maxX - minX, maxY - minY, 1);
    const cell = Math.max(linkDistance * 1.5, spread / 20);
    const cells = /* @__PURE__ */ new Map();
    const cellOf = /* @__PURE__ */ new Map();
    for (const node of nodes) {
      const gx = Math.floor(node.x / cell);
      const gy = Math.floor(node.y / cell);
      const key = `${gx}:${gy}`;
      let bucket = cells.get(key);
      if (!bucket) {
        bucket = { sumX: 0, sumY: 0, count: 0, items: [], cx: gx, cy: gy };
        cells.set(key, bucket);
      }
      bucket.sumX += node.x;
      bucket.sumY += node.y;
      bucket.count++;
      bucket.items.push(node);
      cellOf.set(node, bucket);
    }
    const buckets = [...cells.values()];
    for (let i = 0; i < count; i++) {
      const a = nodes[i];
      const own = cellOf.get(a);
      for (const bucket of buckets) {
        const near = Math.abs(bucket.cx - own.cx) <= 1 && Math.abs(bucket.cy - own.cy) <= 1;
        if (near) {
          for (const b of bucket.items) {
            if (b === a) continue;
            let dx = a.x - b.x;
            let dy = a.y - b.y;
            let distSq = dx * dx + dy * dy;
            if (distSq < 0.01) {
              dx = (i % 7 - 3) * 0.1;
              dy = (i % 5 - 2) * 0.1;
              distSq = dx * dx + dy * dy || 1;
            }
            const dist = Math.sqrt(distSq);
            const force = charge2 / distSq;
            a.vx += dx / dist * force;
            a.vy += dy / dist * force;
          }
        } else {
          const bx = bucket.sumX / bucket.count;
          const by = bucket.sumY / bucket.count;
          const dx = a.x - bx;
          const dy = a.y - by;
          const distSq = dx * dx + dy * dy;
          if (distSq < 0.01) continue;
          const dist = Math.sqrt(distSq);
          const force = charge2 * bucket.count / distSq;
          a.vx += dx / dist * force;
          a.vy += dy / dist * force;
        }
      }
    }
    for (const link of this.links) {
      const { source, target } = link;
      const dx = target.x - source.x;
      const dy = target.y - source.y;
      const dist = Math.sqrt(dx * dx + dy * dy) || 0.01;
      const force = (dist - linkDistance) * 0.06;
      const fx = dx / dist * force;
      const fy = dy / dist * force;
      source.vx += fx;
      source.vy += fy;
      target.vx -= fx;
      target.vy -= fy;
    }
    for (const node of nodes) {
      node.vx -= node.x * 2e-3;
      node.vy -= node.y * 2e-3;
      node.vx *= 0.82;
      node.vy *= 0.82;
      node.x += node.vx * cooling;
      node.y += node.vy * cooling;
    }
    this.ticks++;
  }
  /** Big graphs settle for fewer iterations — the layout is readable well before
   *  it is converged, and a 2,000-node vault should not lock the UI for a minute. */
  maxTicks() {
    if (this.nodes.length > 3e3) return 90;
    if (this.nodes.length > 1200) return 140;
    return 320;
  }
  run() {
    if (this.raf !== null) cancelAnimationFrame(this.raf);
    const limit = this.maxTicks();
    const tick = () => {
      if (this.ticks < limit) {
        this.step();
        if (this.ticks === Math.min(60, limit >> 1)) this.fitToView();
        this.draw();
        this.raf = requestAnimationFrame(tick);
      } else {
        this.fitToView();
        this.draw();
        this.raf = null;
      }
    };
    this.raf = requestAnimationFrame(tick);
  }
  fitToView() {
    if (!this.nodes.length) return;
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const node of this.nodes) {
      minX = Math.min(minX, node.x);
      maxX = Math.max(maxX, node.x);
      minY = Math.min(minY, node.y);
      maxY = Math.max(maxY, node.y);
    }
    const wrap = this.canvas.parentElement;
    if (!wrap) return;
    const padding = 60;
    const width = Math.max(1, maxX - minX);
    const height = Math.max(1, maxY - minY);
    this.scale = Math.min(
      (wrap.clientWidth - padding) / width,
      (wrap.clientHeight - padding) / height,
      2.5
    );
    this.offsetX = wrap.clientWidth / 2 - (minX + maxX) / 2 * this.scale;
    this.offsetY = wrap.clientHeight / 2 - (minY + maxY) / 2 * this.scale;
  }
  toScreen(node) {
    return [node.x * this.scale + this.offsetX, node.y * this.scale + this.offsetY];
  }
  radiusOf(node) {
    return 3 + Math.min(9, Math.sqrt(node.degree) * 1.9);
  }
  nodeAt(px, py) {
    for (let i = this.nodes.length - 1; i >= 0; i--) {
      const node = this.nodes[i];
      const [x, y] = this.toScreen(node);
      const r = this.radiusOf(node) + 4;
      if ((px - x) ** 2 + (py - y) ** 2 <= r * r) return node;
    }
    return null;
  }
  registerCanvasEvents() {
    let dragging = false;
    let lastX = 0;
    let lastY = 0;
    let moved = false;
    this.canvas.addEventListener("mousedown", (event) => {
      dragging = true;
      moved = false;
      lastX = event.offsetX;
      lastY = event.offsetY;
    });
    this.canvas.addEventListener("mousemove", (event) => {
      if (dragging) {
        const dx = event.offsetX - lastX;
        const dy = event.offsetY - lastY;
        if (Math.abs(dx) + Math.abs(dy) > 2) moved = true;
        this.offsetX += dx;
        this.offsetY += dy;
        lastX = event.offsetX;
        lastY = event.offsetY;
        this.draw();
        return;
      }
      const hit = this.nodeAt(event.offsetX, event.offsetY);
      if (hit !== this.hovered) {
        this.hovered = hit;
        this.canvas.style.cursor = hit ? "pointer" : "default";
        this.draw();
      }
    });
    const endDrag = () => {
      dragging = false;
    };
    this.canvas.addEventListener("mouseup", endDrag);
    this.canvas.addEventListener("mouseleave", () => {
      endDrag();
      this.hovered = null;
      this.draw();
    });
    this.canvas.addEventListener("click", (event) => {
      if (moved) return;
      const hit = this.nodeAt(event.offsetX, event.offsetY);
      if (hit) void this.openNode(hit);
    });
    this.canvas.addEventListener("wheel", (event) => {
      event.preventDefault();
      const factor = event.deltaY < 0 ? 1.12 : 1 / 1.12;
      const next = Math.max(0.05, Math.min(8, this.scale * factor));
      this.offsetX = event.offsetX - (event.offsetX - this.offsetX) * next / this.scale;
      this.offsetY = event.offsetY - (event.offsetY - this.offsetY) * next / this.scale;
      this.scale = next;
      this.draw();
    });
  }
  async openNode(node) {
    const path = this.vaultPathFor(node);
    if (!path) {
      new import_obsidian.Notice(`${node.label ?? node.id} \u2014 no source file recorded`);
      return;
    }
    const file = this.app.vault.getAbstractFileByPath(path);
    if (!(file instanceof import_obsidian.TFile)) {
      new import_obsidian.Notice(`Not in this vault: ${path}`);
      return;
    }
    const leaf = this.app.workspace.getLeaf("tab");
    await leaf.openFile(file);
    const match = /^L(\d+)$/.exec(node.source_location ?? "");
    if (match) {
      const line = Math.max(0, parseInt(match[1], 10) - 1);
      const view = leaf.view;
      if (view.editor) {
        view.editor.setCursor({ line, ch: 0 });
        view.editor.scrollIntoView({ from: { line, ch: 0 }, to: { line, ch: 0 } }, true);
      }
    }
  }
  draw() {
    const ctx = this.ctx;
    const wrap = this.canvas.parentElement;
    if (!ctx || !wrap) return;
    ctx.clearRect(0, 0, wrap.clientWidth, wrap.clientHeight);
    if (!this.nodes.length) {
      this.status(this.statusEl.getText() || "No graph loaded.");
      return;
    }
    const dim = this.query.length > 0;
    const { showLabels, colorBy } = this.plugin.settings;
    ctx.lineWidth = 1;
    for (const link of this.links) {
      const [x1, y1] = this.toScreen(link.source);
      const [x2, y2] = this.toScreen(link.target);
      const lit = this.hovered !== null && (link.source.id === this.hovered.id || link.target.id === this.hovered.id);
      ctx.strokeStyle = lit ? "rgba(144, 97, 255, 0.85)" : dim ? "rgba(130,130,130,0.10)" : "rgba(130,130,130,0.24)";
      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.lineTo(x2, y2);
      ctx.stroke();
    }
    for (const node of this.nodes) {
      const [x, y] = this.toScreen(node);
      const r = this.radiusOf(node);
      const matched = !dim || this.matches.has(node.id);
      ctx.globalAlpha = matched ? 1 : 0.15;
      ctx.fillStyle = colorFor(node, colorBy);
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fill();
      if (this.hovered?.id === node.id) {
        ctx.strokeStyle = "#ffffff";
        ctx.lineWidth = 2;
        ctx.stroke();
        ctx.lineWidth = 1;
      }
      ctx.globalAlpha = 1;
    }
    if (showLabels) {
      ctx.font = "11px var(--font-interface, sans-serif)";
      ctx.textAlign = "center";
      const styles = getComputedStyle(this.containerEl);
      const textColor = styles.getPropertyValue("--text-normal").trim() || "#ccc";
      const degreeBar = this.nodes.length > 1200 ? 12 : this.nodes.length > 400 ? 7 : 4;
      for (const node of this.nodes) {
        const big = node.degree >= degreeBar || this.matches.has(node.id) || this.hovered?.id === node.id;
        if (!big) continue;
        const [x, y] = this.toScreen(node);
        const label = node.label ?? node.id;
        const text = label.length > 34 ? `${label.slice(0, 33)}\u2026` : label;
        ctx.fillStyle = textColor;
        ctx.globalAlpha = !dim || this.matches.has(node.id) ? 0.95 : 0.2;
        ctx.fillText(text, x, y - this.radiusOf(node) - 5);
        ctx.globalAlpha = 1;
      }
    }
    const hoveredText = this.hovered ? ` \xB7 ${this.hovered.label ?? this.hovered.id}${this.hovered.source_file ? ` (${this.hovered.source_file})` : ""}` : "";
    const matchText = this.query ? ` \xB7 ${this.matches.size} match${this.matches.size === 1 ? "" : "es"}` : "";
    this.status(`${this.nodes.length} nodes \xB7 ${this.links.length} edges${matchText}${hoveredText}`);
  }
};
var GraphifySettingTab = class extends import_obsidian.PluginSettingTab {
  constructor(app, plugin) {
    super(app, plugin);
    this.plugin = plugin;
  }
  display() {
    const { containerEl } = this;
    containerEl.empty();
    const found = this.plugin.findGraphs();
    const graphSetting = new import_obsidian.Setting(containerEl).setName("Graph file").setDesc(
      found.length ? `${found.length} graph${found.length === 1 ? "" : "s"} found in this vault. Leave blank to use the first.` : "No graphify graph in this vault yet. Build one with `graphify update <folder>`."
    );
    if (found.length > 0) {
      graphSetting.addDropdown((dropdown) => {
        dropdown.addOption("", "(first one found)");
        for (const path of found) dropdown.addOption(path, path);
        dropdown.setValue(found.includes(this.plugin.settings.graphPath) ? this.plugin.settings.graphPath : "").onChange(async (value) => {
          this.plugin.settings.graphPath = value;
          await this.plugin.saveSettings();
        });
      });
    } else {
      graphSetting.addText(
        (text) => text.setPlaceholder("path/to/graphify-out/graph.json").setValue(this.plugin.settings.graphPath).onChange(async (value) => {
          this.plugin.settings.graphPath = value.trim();
          await this.plugin.saveSettings();
        })
      );
    }
    new import_obsidian.Setting(containerEl).setName("Refreshing").setHeading();
    new import_obsidian.Setting(containerEl).setName("Rebuild when Obsidian starts").setDesc(
      "Runs `graphify update` then the note export, three seconds after the workspace is ready. Off by default \u2014 it rewrites the export folder every launch."
    ).addToggle(
      (toggle) => toggle.setValue(this.plugin.settings.refreshOnStartup).onChange(async (value) => {
        this.plugin.settings.refreshOnStartup = value;
        await this.plugin.saveSettings();
      })
    );
    new import_obsidian.Setting(containerEl).setName("Refresh now").setDesc("Same thing, on demand. Also in the command palette.").addButton(
      (button) => button.setButtonText("Rebuild + export").setCta().onClick(async () => {
        button.setButtonText("Working\u2026");
        await this.plugin.refresh();
        button.setButtonText("Rebuild + export");
      })
    );
    new import_obsidian.Setting(containerEl).setName("Project folder").setDesc("Vault-relative folder to re-index.").addText(
      (text) => text.setPlaceholder(DEFAULT_SETTINGS.projectFolder).setValue(this.plugin.settings.projectFolder).onChange(async (value) => {
        this.plugin.settings.projectFolder = value.trim();
        await this.plugin.saveSettings();
      })
    );
    new import_obsidian.Setting(containerEl).setName("Export folder").setDesc(
      "Vault-relative folder of generated notes. WIPED AND REWRITTEN on every refresh \u2014 keep nothing else there. Blank to skip the export."
    ).addText(
      (text) => text.setPlaceholder(DEFAULT_SETTINGS.exportOut).setValue(this.plugin.settings.exportOut).onChange(async (value) => {
        this.plugin.settings.exportOut = value.trim();
        await this.plugin.saveSettings();
      })
    );
    new import_obsidian.Setting(containerEl).setName("Anchor note").setDesc("Existing note every group links up to, so the graph joins your vault.").addText(
      (text) => text.setPlaceholder(DEFAULT_SETTINGS.anchorNote).setValue(this.plugin.settings.anchorNote).onChange(async (value) => {
        this.plugin.settings.anchorNote = value.trim();
        await this.plugin.saveSettings();
      })
    );
    new import_obsidian.Setting(containerEl).setName("graphify binary").addText(
      (text) => text.setPlaceholder(DEFAULT_SETTINGS.graphifyBin).setValue(this.plugin.settings.graphifyBin).onChange(async (value) => {
        this.plugin.settings.graphifyBin = value.trim();
        await this.plugin.saveSettings();
      })
    );
    new import_obsidian.Setting(containerEl).setName("Exporter script").setDesc("Absolute path to export_obsidian.py.").addText((text) => {
      text.inputEl.style.width = "22em";
      text.setPlaceholder(DEFAULT_SETTINGS.exporterPath).setValue(this.plugin.settings.exporterPath).onChange(async (value) => {
        this.plugin.settings.exporterPath = value.trim();
        await this.plugin.saveSettings();
      });
    });
    new import_obsidian.Setting(containerEl).setName("Appearance").setHeading();
    new import_obsidian.Setting(containerEl).setName("Colour nodes by").setDesc("Community grouping, or whether the node came from code, a document, or a rationale.").addDropdown(
      (dropdown) => dropdown.addOption("community", "Community").addOption("fileType", "File type").setValue(this.plugin.settings.colorBy).onChange(async (value) => {
        this.plugin.settings.colorBy = value;
        await this.plugin.saveSettings();
      })
    );
    new import_obsidian.Setting(containerEl).setName("Show labels").addToggle(
      (toggle) => toggle.setValue(this.plugin.settings.showLabels).onChange(async (value) => {
        this.plugin.settings.showLabels = value;
        await this.plugin.saveSettings();
      })
    );
    new import_obsidian.Setting(containerEl).setName("Link distance").addSlider(
      (slider) => slider.setLimits(20, 140, 5).setValue(this.plugin.settings.linkDistance).setDynamicTooltip().onChange(async (value) => {
        this.plugin.settings.linkDistance = value;
        await this.plugin.saveSettings();
      })
    );
    new import_obsidian.Setting(containerEl).setName("Repulsion").addSlider(
      (slider) => slider.setLimits(80, 600, 20).setValue(this.plugin.settings.chargeStrength).setDynamicTooltip().onChange(async (value) => {
        this.plugin.settings.chargeStrength = value;
        await this.plugin.saveSettings();
      })
    );
  }
};
var GraphifyViewerPlugin = class extends import_obsidian.Plugin {
  settings = { ...DEFAULT_SETTINGS };
  refreshing = false;
  async onload() {
    await this.loadSettings();
    this.registerView(VIEW_TYPE_GRAPHIFY, (leaf) => new GraphifyView(leaf, this));
    this.addRibbonIcon("git-fork", "Open graphify graph", () => void this.activateView());
    this.addCommand({
      id: "open-graphify-graph",
      name: "Open graphify graph",
      callback: () => void this.activateView()
    });
    this.addCommand({
      id: "refresh-graphify-graph",
      name: "Rebuild the graph and re-export notes",
      callback: () => void this.refresh()
    });
    this.addSettingTab(new GraphifySettingTab(this.app, this));
    if (this.settings.refreshOnStartup) {
      this.app.workspace.onLayoutReady(() => {
        window.setTimeout(() => void this.refresh(true), 3e3);
      });
    }
  }
  vaultPath() {
    return this.app.vault.adapter.basePath ?? "";
  }
  /** Every graphify graph in this vault, so one build works across all of them. */
  findGraphs() {
    return this.app.vault.getFiles().map((f) => f.path).filter((p) => p.endsWith(GRAPH_SUFFIX)).sort();
  }
  /** The folder to re-index: configured, else derived from the graph path. */
  resolveProjectFolder() {
    const explicit = this.settings.projectFolder.trim();
    if (explicit) return explicit;
    const graph = this.settings.graphPath.trim() || this.findGraphs()[0] || "";
    if (!graph.endsWith(GRAPH_SUFFIX)) return "";
    return graph.slice(0, Math.max(0, graph.length - GRAPH_SUFFIX.length - 1));
  }
  run(bin, args, cwd) {
    return new Promise((resolve, reject) => {
      const child = (0, import_node_child_process.spawn)(bin, args, { cwd });
      let out = "";
      let err = "";
      child.stdout.on("data", (c) => out += c.toString());
      child.stderr.on("data", (c) => err += c.toString());
      child.on("error", (error) => reject(new Error(`${bin}: ${error.message}`)));
      child.on("close", (code) => {
        if (code === 0) resolve(out.trim());
        else reject(new Error((err || out).trim().split("\n").slice(-3).join(" ") || `exit ${code}`));
      });
    });
  }
  /** Re-index the project, re-export the notes, and reload any open view. */
  async refresh(quiet = false) {
    if (this.refreshing) {
      if (!quiet) new import_obsidian.Notice("A graph refresh is already running.");
      return;
    }
    this.refreshing = true;
    const vault = this.vaultPath();
    const notice = quiet ? null : new import_obsidian.Notice("Rebuilding graph\u2026", 0);
    try {
      const projectFolder = this.resolveProjectFolder();
      if (!projectFolder) {
        throw new Error(
          "no project folder to index \u2014 set one in settings, or build a graph with `graphify update <folder>`"
        );
      }
      const project = `${vault}/${projectFolder}`;
      await this.run(this.settings.graphifyBin, ["update", "."], project);
      notice?.setMessage("Graph rebuilt. Exporting notes\u2026");
      if (this.settings.exportOut.trim() && this.settings.exporterPath.trim()) {
        const args = [
          this.settings.exporterPath,
          `${projectFolder}/${GRAPH_SUFFIX}`,
          "--out",
          this.settings.exportOut,
          "--vault-root",
          ".",
          "--source-root",
          projectFolder
        ];
        if (this.settings.anchorNote.trim()) args.push("--anchor", this.settings.anchorNote);
        await this.run(this.settings.pythonBin, args, vault);
      }
      for (const leaf of this.app.workspace.getLeavesOfType(VIEW_TYPE_GRAPHIFY)) {
        const view = leaf.view;
        if (view instanceof GraphifyView) await view.reload();
      }
      notice?.hide();
      if (!quiet) new import_obsidian.Notice("Graph refreshed.");
    } catch (error) {
      notice?.hide();
      const message = error instanceof Error ? error.message : String(error);
      new import_obsidian.Notice(`Graph refresh failed: ${message}`, 1e4);
    } finally {
      this.refreshing = false;
    }
  }
  async activateView() {
    const existing = this.app.workspace.getLeavesOfType(VIEW_TYPE_GRAPHIFY);
    if (existing.length > 0) {
      this.app.workspace.revealLeaf(existing[0]);
      return;
    }
    const leaf = this.app.workspace.getLeaf("tab");
    await leaf.setViewState({ type: VIEW_TYPE_GRAPHIFY, active: true });
    this.app.workspace.revealLeaf(leaf);
  }
  async loadSettings() {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
  }
  async saveSettings() {
    await this.saveData(this.settings);
  }
};
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  VIEW_TYPE_GRAPHIFY
});
