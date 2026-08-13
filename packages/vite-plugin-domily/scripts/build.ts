import path from "path";

const outdir = path.resolve(import.meta.dir, "..", "lib");
const typeFileDir = path.resolve(import.meta.dir, "..", "types");

await Bun.$`rm -rf ${outdir}`;

const build = async () => {
  const config = [
    {
      target: "node" as const,
      format: "esm" as const,
      naming: {
        entry: "[name].js",
      },
    },
    {
      target: "node" as const,
      format: "cjs" as const,
      naming: {
        entry: "[name].cjs",
      },
    },
  ];

  await Promise.all(
    config.map((e) =>
      Bun.build({
        entrypoints: [path.resolve(import.meta.dir, "..", "index.ts")],
        outdir,
        minify: true,
        external: [
          "less",
          "sass",
          "vite",
          "vite-plugin-inspect",
          "@domily/runtime-core",
          "@domily/router",
        ],
        ...e,
      })
    )
  );

  await Bun.$`cp -r ${typeFileDir} ${path.resolve(outdir, "types")}`;
};

await build();
