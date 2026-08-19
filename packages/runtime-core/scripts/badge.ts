import path from "path";
import pkg from "../package.json";

const endpoints = ["index.cjs", "index.esm.js", "index.umd.js"].map((e) =>
  path.resolve(import.meta.dir, "../lib", e)
);

async function withBadge() {
  const badge = (type?: string) => `/**
 * @name ${pkg.name}
 * @type ${type || "unknown"}
 * @version ${pkg.version}
 * @author ${pkg.author}
 * @license ${pkg.license}
 */`;

  for (const endpoint of endpoints) {
    const type = endpoint.split(path.sep).at(-1)?.split(".").at(-2);
    const originalText = await Bun.file(endpoint).text();
    const newText = `${badge(type)}\n${originalText}`;
    await Bun.write(endpoint, newText);
  }
}

withBadge();
