import { describe, expect, test } from 'bun:test';

import {
  createSourceCodecRegistry,
  type SourceCodec,
} from '../../src/codec/index.ts';

const fixtureCodec: SourceCodec = {
  id: 'fixture',
  version: '1.0.0',
  extensions: ['dmy.fixture'],
  mediaTypes: ['application/vnd.domily-fixture'],
  parse(payload) {
    return { ok: true, value: { payload, value: { schema: 'domily.page/v1' } }, issues: [] };
  },
};

describe('source codec registry', () => {
  test('looks codecs up by normalized source metadata without assigning PageSpec semantics', () => {
    const registry = createSourceCodecRegistry([fixtureCodec]);

    expect(registry.byId('fixture')).toMatchObject({ id: 'fixture', version: '1.0.0' });
    expect(registry.byExtension('.DMY.FIXTURE')).toBe(registry.byId('fixture'));
    expect(registry.byMediaType('APPLICATION/VND.DOMILY-FIXTURE')).toBe(registry.byId('fixture'));
  });

  test('rejects duplicate source metadata instead of silently replacing a codec', () => {
    const registry = createSourceCodecRegistry([fixtureCodec]);
    expect(() => registry.register({ ...fixtureCodec, id: 'other' })).toThrow('extension');
    expect(() => registry.register({ ...fixtureCodec, id: 'other-media', extensions: ['dmy.other'] })).toThrow('media type');
  });

  test('captures immutable codec metadata while retaining only trusted parser callbacks', () => {
    const mutable = { ...fixtureCodec, extensions: ['mutable'] };
    const registry = createSourceCodecRegistry([mutable]);
    mutable.extensions[0] = 'changed';
    mutable.version = '2.0.0';

    expect(registry.byExtension('mutable')).toMatchObject({ extensions: ['mutable'], version: '1.0.0' });
    expect(registry.byExtension('changed')).toBeUndefined();
  });
});
