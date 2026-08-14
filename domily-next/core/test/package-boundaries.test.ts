import { describe, expect, test } from 'bun:test';

interface PackageManifest {
  dependencies?: Record<string, string>;
  exports: Record<string, unknown>;
  peerDependencies?: Record<string, string>;
}

const manifest = await Bun.file(new URL('../package.json', import.meta.url)).json() as PackageManifest;

describe('@domily/next package boundaries', () => {
  test('exports protocol primitives but not concrete codec or Vite implementations', () => {
    expect(Object.keys(manifest.exports).sort()).toEqual(['.', './author', './codec', './compiler']);
    expect(manifest.peerDependencies).toBeUndefined();
    expect(manifest.dependencies?.vite).toBeUndefined();
  });
});
