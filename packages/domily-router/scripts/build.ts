import path from "path";

const outdir = path.resolve(import.meta.dir, "..", "lib");

await Bun.$`rm -rf ${outdir}`;

const config = [
  {
    format: "iife" as const,
    naming: {
      entry: "[name].iife.[ext]",
    },
  },
  {
    format: "esm" as const,
    naming: {
      entry: "[name].esm.[ext]",
    },
  },
  {
    format: "cjs" as const,
    naming: {
      entry: "[name].cjs",
    },
  },
];

await Promise.all(
  config.map((e) =>
    Bun.build({
      entrypoints: [path.resolve(import.meta.dir, "..", "src", "index.ts")],
      outdir,
      minify: true,
      external: ["@domily/runtime-core"],
      ...e,
    })
  )
);
