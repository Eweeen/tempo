import { createHash } from "node:crypto";
import { readdir, readFile, writeFile } from "node:fs/promises";
import { join, relative, resolve, sep } from "node:path";
import { defineConfig } from "vite";
import type { Plugin, ResolvedConfig } from "vite";
import react from "@vitejs/plugin-react";

/** Generate after Vite has written index.html, public files and hashed chunks. */
function offlineShell(): Plugin {
  let config: ResolvedConfig;
  return {
    name: "tempo-offline-shell",
    apply: "build",
    enforce: "post",
    configResolved(resolved) {
      config = resolved;
    },
    async writeBundle() {
      const output = resolve(config.root, config.build.outDir);
      const files: string[] = [];
      async function collect(directory: string) {
        for (const entry of await readdir(directory, { withFileTypes: true })) {
          const path = join(directory, entry.name);
          if (entry.isDirectory()) await collect(path);
          else if (entry.isFile()) files.push(path);
        }
      }
      await collect(output);
      const assets = files
        .filter(
          (path) => !path.endsWith(`${sep}sw.js`) && !path.endsWith(".map"),
        )
        .sort();
      const template = await readFile(
        resolve(config.publicDir, "sw.js"),
        "utf8",
      );
      const hash = createHash("sha256").update(template);
      for (const file of assets) {
        hash.update(relative(output, file));
        hash.update(await readFile(file));
      }
      const urls = [
        "/",
        ...assets.map(
          (path) => `/${relative(output, path).split(sep).join("/")}`,
        ),
      ];
      const worker = template
        .replace(
          "__TEMPO_CACHE_NAME__",
          `tempo-shell-${hash.digest("hex").slice(0, 16)}`,
        )
        .replace("/* __TEMPO_PRECACHE__ */ []", JSON.stringify(urls))
        .replace("__TEMPO_APP_SHELL__", "/index.html");
      await writeFile(join(output, "sw.js"), worker);
    },
  };
}

export default defineConfig({
  base: "/",
  plugins: [react(), offlineShell()],
  server: { host: "0.0.0.0" },
});
