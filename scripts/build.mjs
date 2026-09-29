import { build } from "esbuild";

for (const [entry, outfile] of [
  ["src/main/index.ts", "dist/main.mjs"],
  ["src/main/preload.ts", "dist/preload.cjs"],
  ["src/service/index.ts", "dist/service.mjs"],
]) {
  await build({
    entryPoints: [entry],
    outfile,
    bundle: true,
    platform: "node",
    format: outfile.endsWith(".cjs") ? "cjs" : "esm",
    target: "node22",
    packages: "external",
    sourcemap: true,
  });
}
