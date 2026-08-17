import { describe, expect, test } from 'bun:test';

import { createJsonSourceCodecRegistry, jsonPageCodec } from '../src/index.ts';

describe('@domily/next-codec-json', () => {
  test('owns the JSON source codec implementation', () => {
    expect(jsonPageCodec.id).toBe('json');
    expect(createJsonSourceCodecRegistry().byId('json')).toMatchObject({
      id: 'json',
      version: '1.0.0',
    });
  });
});
