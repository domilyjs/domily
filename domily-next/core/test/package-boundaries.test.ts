import { describe, expect, test } from 'bun:test';

interface PackageManifest {
  dependencies?: Record<string, string>;
  exports: Record<string, unknown>;
  peerDependencies?: Record<string, string>;
}

const manifest = await Bun.file(new URL('../package.json', import.meta.url)).json() as PackageManifest;
const publicSourceFiles = [
  '../src/index.ts',
  '../src/business-form.ts',
  '../src/business-form/index.ts',
  '../src/business-form/manifest.ts',
  '../src/business-form/register.ts',
  '../src/business-form/renderer.ts',
  '../src/business-form/runtime.ts',
  '../src/codec.ts',
  '../src/codec/index.ts',
  '../src/codec/types.ts',
  '../src/codec/value.ts',
  '../src/delivery.ts',
  '../src/delivery/client.ts',
  '../src/delivery/envelope.ts',
  '../src/delivery/index.ts',
  '../src/delivery/integrity.ts',
  '../src/delivery/store.ts',
  '../src/delivery/types.ts',
  '../src/dom.ts',
  '../src/dom/index.ts',
  '../src/dom/page-host.ts',
  '../src/dom/page-renderer.ts',
  '../src/dom/renderer-registry.ts',
  '../src/dom/scope.ts',
  '../src/dom/types.ts',
  '../src/dom/value.ts',
  '../src/extensions.ts',
  '../src/extensions/index.ts',
  '../src/extensions/registry.ts',
  '../src/extensions/types.ts',
  '../src/native-html.ts',
  '../src/native-html/index.ts',
  '../src/pagespec.ts',
  '../src/pagespec/binding.ts',
  '../src/pagespec/define.ts',
  '../src/pagespec/index.ts',
  '../src/pagespec/normalize.ts',
  '../src/pagespec/types.ts',
  '../src/registry.ts',
  '../src/registry/index.ts',
  '../src/registry/schema.ts',
  '../src/registry/types.ts',
];
const publicSources = await Promise.all(
  publicSourceFiles.map(async (file) => Bun.file(new URL(file, import.meta.url)).text()),
);

describe('@domily/next package boundaries', () => {
  test('exports only the current PageSpec protocol, host, delivery, extension, and optional preset contracts', () => {
    expect(Object.keys(manifest.exports).sort()).toEqual(['.', './business-form', './codec', './delivery', './dom', './extensions', './native-html', './pagespec', './registry']);
    expect(manifest.peerDependencies).toBeUndefined();
    expect(manifest.dependencies).toBeUndefined();
  });

  test('does not retain imports from the discarded execution-AST architecture', () => {
    expect(publicSources.join('\n')).not.toMatch(
      /(?:from|import).*['"].*\/(?:ast|runtime|renderer-dom|validator|dom-host|loader|compiler|author)(?:\/|['"])/,
    );
  });
});
