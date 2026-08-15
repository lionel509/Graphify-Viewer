/** Copy the built plugin into every vault that touches code.
 *
 *  Vanguard is deliberately absent and must stay that way — it is off-limits.
 *  Goldman and Fidelity hold no code, so the graph viewer has nothing to show.
 */
import { copyFile, mkdir, access } from "node:fs/promises";
import { join } from "node:path";

/** Override with OBSIDIAN_VAULT (umbrella folder) or OBSIDIAN_VAULTS
 *  (colon-separated list of vault paths, replacing the list entirely). */
const DOCS = process.env.OBSIDIAN_VAULT ?? "/Users/lionelweng/Documents";

const VAULTS = process.env.OBSIDIAN_VAULTS
  ? process.env.OBSIDIAN_VAULTS.split(":").filter(Boolean)
  : [
      DOCS,                        // umbrella — contains every sub-vault
      `${DOCS}/Citadel`,           // projects and builds
      `${DOCS}/BlackRock`,         // coursework
      `${DOCS}/Berkshire`,         // store ops and bots
      `${DOCS}/State Street`,      // finance scripts
    ];

for (const vault of VAULTS) {
  const target = join(vault, ".obsidian/plugins/graphify-viewer");
  try {
    await access(join(vault, ".obsidian"));
  } catch {
    console.log(`skipped ${vault} — not an Obsidian vault`);
    continue;
  }
  await mkdir(target, { recursive: true });
  for (const file of ["main.js", "manifest.json", "styles.css"]) {
    await copyFile(file, join(target, file));
  }
  console.log(`installed -> ${target}`);
}

console.log("\nReload each vault, then enable 'Graphify Viewer' in Community Plugins.");
