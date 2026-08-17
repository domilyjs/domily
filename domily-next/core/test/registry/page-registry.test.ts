import { describe, expect, test } from 'bun:test';

import {
  PageRegistryError,
  createPageRegistry,
  type ComponentCatalogManifest,
} from '../../src/registry/index.ts';

function catalog(overrides: Partial<ComponentCatalogManifest> = {}): ComponentCatalogManifest {
  return {
    schema: 'domily.component-catalog/v1',
    id: '@example/components',
    version: '1.2.0',
    namespace: 'app',
    components: {
      Card: { description: 'A card.' },
    },
    ...overrides,
  };
}

describe('Page registry', () => {
  test('resolves a compatible catalog requirement and its namespaced component', () => {
    const registry = createPageRegistry();
    registry.registerComponentCatalog(catalog());

    expect(registry.resolveCatalog({ id: '@example/components', range: '^1' })?.manifest.version).toBe('1.2.0');
    expect(registry.resolveComponent('app.Card')?.catalog.id).toBe('@example/components');
  });

  test('rejects duplicate namespaces instead of allowing a last registration to win', () => {
    const registry = createPageRegistry();
    registry.registerComponentCatalog(catalog());

    expect(() => registry.registerComponentCatalog(catalog({ id: '@example/other' }))).toThrow(PageRegistryError);
  });

  test('does not resolve an incompatible major version', () => {
    const registry = createPageRegistry();
    registry.registerComponentCatalog(catalog());

    expect(registry.resolveCatalog({ id: '@example/components', range: '^2' })).toBeUndefined();
  });

  test('uses standard-compatible shorthand ranges without silently broadening them', () => {
    const registry = createPageRegistry();
    registry.registerComponentCatalog(catalog());

    expect(registry.resolveCatalog({ id: '@example/components', range: '~1' })?.manifest.version).toBe('1.2.0');
    expect(registry.resolveCatalog({ id: '@example/components', range: '~1.1' })).toBeUndefined();
  });

  test('snapshots and freezes manifests so caller mutation cannot change page permissions', () => {
    const registry = createPageRegistry();
    const source = catalog({ delivery: { remotePage: false } }) as unknown as {
      delivery: { remotePage: boolean };
    } & ComponentCatalogManifest;

    registry.registerComponentCatalog(source);
    source.delivery.remotePage = true;

    const registered = registry.resolveCatalog({ id: '@example/components' })?.manifest;
    expect(registered?.delivery?.remotePage).toBe(false);
    expect(Object.isFrozen(registered)).toBe(true);
    expect(Object.isFrozen(registered?.delivery)).toBe(true);
  });

  test('captures a registry snapshot that does not observe later registrations', () => {
    const registry = createPageRegistry();
    registry.registerComponentCatalog(catalog());
    const snapshot = registry.snapshot();

    registry.registerComponentCatalog(catalog({
      id: '@example/new-components',
      namespace: 'newapp',
    }));

    expect(snapshot.revision).toBe(1);
    expect(snapshot.resolveComponent('newapp.Card')).toBeUndefined();
    expect(registry.resolveComponent('newapp.Card')?.type).toBe('newapp.Card');
  });

  test('rejects manifests with executable or undeclared fields before registration', () => {
    const registry = createPageRegistry();
    const unsafe = {
      ...catalog(),
      renderer: 'not-a-local-implementation',
    } as ComponentCatalogManifest & { renderer: string };

    expect(() => registry.registerComponentCatalog(unsafe)).toThrow(PageRegistryError);
  });

  test('requires a trusted event mapping for every readwrite binding', () => {
    const registry = createPageRegistry();
    const invalid = catalog({
      components: {
        Input: {
          description: 'An incomplete input.',
          bindings: { value: { mode: 'readwrite' } },
        },
      },
    });

    expect(() => registry.registerComponentCatalog(invalid)).toThrow(PageRegistryError);
  });
});
