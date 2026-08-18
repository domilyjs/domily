import { describe, expect, test } from 'bun:test';

import {
  createToonSourceCodecRegistry,
  TOON_CODEC_VERSION,
  TOON_PARSER_VERSION,
  TOON_SPEC_VERSION,
  toonPageCodec,
} from '../src/index.ts';

const manifest = await Bun.file(new URL('../package.json', import.meta.url)).json() as {
  dependencies?: Record<string, string>;
};

describe('@domily/next-codec-toon', () => {
  test('owns the audited TOON source codec implementation', () => {
    expect(toonPageCodec).toMatchObject({
      id: 'toon',
      version: TOON_CODEC_VERSION,
      extensions: ['dmy.toon'],
      mediaTypes: ['text/toon'],
    });
    expect(TOON_SPEC_VERSION).toBe('4.1');
    expect(TOON_PARSER_VERSION).toBe('4.1.1');
    expect(manifest.dependencies?.['@toon-format/toon']).toBe(TOON_PARSER_VERSION);
    expect(createToonSourceCodecRegistry().byId('toon')).toMatchObject({ version: TOON_CODEC_VERSION });
  });
});
