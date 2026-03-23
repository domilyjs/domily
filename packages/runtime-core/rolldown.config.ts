import { defineConfig, type RolldownOptions } from "rolldown";

export default defineConfig([
  {
    input: "src/index.ts",
    output: [
      {
        dir: "lib",
        format: "umd",
        name: "DOMily",
        entryFileNames: "[name].umd.js",
        minify: true,
      },
      {
        dir: "lib",
        format: "esm",
        entryFileNames: "[name].esm.js",
        minify: true,
      },
      {
        dir: "lib",
        format: "cjs",
        entryFileNames: "[name].cjs.js",
        minify: true,
      },
    ],
  } as RolldownOptions,
]);
