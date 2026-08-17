import { describe, expect, test } from 'bun:test';

import {
  createPageExtensionRuntimeRegistry,
  PageExtensionRuntimeRegistryError,
  type TrustedPageExtensionRuntime,
} from '../../src/extensions/index.ts';

describe('Page extension runtime registry', () => {
  test('captures immutable runtime metadata while retaining only the trusted activation callback', () => {
    const activate = () => ({});
    const runtime: TrustedPageExtensionRuntime = {
      id: '@test/draft-runtime',
      version: '1.0.0',
      allowRemote: true,
      scopes: [{ name: 'draft', mode: 'read', value: { type: 'object', additionalProperties: true } }],
      activate,
    };
    const registry = createPageExtensionRuntimeRegistry([runtime]);
    const mutableRuntime = runtime as unknown as { allowRemote: boolean; scopes: unknown[] };
    mutableRuntime.allowRemote = false;
    mutableRuntime.scopes = [];

    const registered = registry.snapshot().get('@test/draft-runtime');
    expect(registered).toBeDefined();
    if (!registered) throw new Error('Missing registered runtime.');
    const scope = registered.scopes[0];
    if (!scope) throw new Error('Missing registered scope.');
    expect(registered.allowRemote).toBe(true);
    expect(registered.scopes).toEqual([{ name: 'draft', mode: 'read', value: { type: 'object', additionalProperties: true } }]);
    expect(registered.activate).toBe(activate);
    expect(Object.isFrozen(registered)).toBe(true);
    expect(Object.isFrozen(registered.scopes)).toBe(true);
    expect(Object.isFrozen(scope.value)).toBe(true);
    expect(() => {
      (scope.value as unknown as { type: string }).type = 'string';
    }).toThrow();
  });

  test('defaults remote permission and scopes conservatively and rejects duplicate runtime ids', () => {
    const registry = createPageExtensionRuntimeRegistry();
    registry.register({ id: '@test/local', version: '1.0.0', activate() { return {}; } });
    const registered = registry.get('@test/local');
    expect(registered?.allowRemote).toBe(false);
    expect(registered?.scopes).toEqual([]);

    expect(() => registry.register({ id: '@test/local', version: '1.0.0', activate() { return {}; } }))
      .toThrow(PageExtensionRuntimeRegistryError);
  });
});
