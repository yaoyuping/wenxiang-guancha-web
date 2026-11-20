import { build } from "esbuild";
import fs from "node:fs/promises";
await fs.rm("dist", { recursive: true, force: true });
await fs.mkdir("dist", { recursive: true });
await fs.cp("static", "dist", { recursive: true });
await build({
  entryPoints: ["src/app.js"],
  bundle: true,
  format: "esm",
  outfile: "dist/app.js",
  minify: true,
  target: ["es2022"],
  alias: { "node:crypto": "./src/crypto-shim.js" },
  inject: ["./src/buffer-shim.js"],
});
for (const f of ["index.html", "style.css", "manifest.webmanifest", "sw.js"])
  await fs.copyFile(f, "dist/" + f);
await fs.writeFile("dist/.nojekyll", "");
console.log("Built dist/ for GitHub Pages");
