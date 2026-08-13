import { describe, expect, test } from 'bun:test';

import { createCodecRegistry, type DocumentCodec } from '../src';

const codec: DocumentCodec = {
  id: 'fixture',
  extensions: ['fixture', '.domily.fixture'],
  mediaTypes: ['application/vnd.domily-fixture'],
  parse: () => ({ ok: false, issues: [] }),
  serialize: () => ({ ok: false, issues: [] }),
};

describe('codec registry', () => {
  test('looks codecs up without binding callers to JSON', () => {
    const registry = createCodecRegistry();
    registry.register(codec);

    expect(registry.byId('fixture')).toBe(codec);
    expect(registry.byExtension('.FIXTURE')).toBe(codec);
    expect(registry.byExtension('domily.fixture')).toBe(codec);
    expect(registry.byMediaType('APPLICATION/VND.DOMILY-FIXTURE')).toBe(codec);
  });

  test('rejects duplicate codec identifiers', () => {
    const registry = createCodecRegistry();
    registry.register(codec);

    expect(() => registry.register(codec)).toThrow('already registered');
  });
});
