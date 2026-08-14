import { describe, expect, test } from 'bun:test';

import { createJsonCodecRegistry, jsonDocumentCodec } from '../src/index.ts';

describe('@domily/next-codec-json', () => {
  test('owns the JSON codec implementation', () => {
    expect(jsonDocumentCodec.id).toBe('json');
    expect(createJsonCodecRegistry().byId('json')).toBe(jsonDocumentCodec);
  });
});
