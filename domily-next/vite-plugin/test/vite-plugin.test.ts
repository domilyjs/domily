import { describe, expect, test } from 'bun:test';

import { createSourceCodecRegistry, type SourceCodec } from '@domily/next/codec';
import { nativeHtmlCatalog } from '@domily/next/native-html';
import { createPageRegistry } from '@domily/next/registry';
import {
  DomilyVitePageError,
  domilyNext,
  transformDomilyJsonModule,
} from '../src/index.ts';

const page = JSON.stringify({
  schema: 'domily.page/v1',
  id: 'vite-json',
  requires: { catalogs: ['@domily/native-html'] },
  ui: { type: 'html.div', props: { className: 'page' } },
});

const toonFixtureCodec: SourceCodec = {
  extensions: ['dmy.toon'],
  id: 'toon-fixture',
  mediaTypes: ['text/x-domily-toon-fixture'],
  parse(payload) {
    if (payload.kind !== 'text') {
      return { ok: false, issues: [{ code: 'toon.payload.kind.invalid', message: 'Expected text.' }] };
    }
    if (payload.text === 'invalid') {
      return {
        ok: false,
        issues: [{
          code: 'toon.syntax',
          location: { column: 5, line: 2, offset: 13 },
          message: 'Fixture TOON is invalid.',
        }],
      };
    }
    return {
      ok: true,
      issues: [],
      value: {
        payload,
        value: {
          id: 'vite-toon',
          requires: { catalogs: ['@domily/native-html'] },
          schema: 'domily.page/v1',
          ui: { props: { className: 'page' }, type: 'html.div' },
        },
      },
    };
  },
  version: '4.1.0-fixture.0',
};

describe('Domily Next Vite plugin', () => {
  test('turns .dmy.json into an import-free PageSpec ES module', () => {
    const transformed = domilyNext().transform(page, '/src/todos.dmy.json?domily=page');

    expect(transformed).not.toBeNull();
    expect(transformed?.code).toContain('export default page;');
    expect(transformed?.code).not.toContain("from '@domily/next");
  });

  test('leaves local .dmy.ts to Vite native TypeScript handling instead of creating a macro language', () => {
    const localPage = "import { definePage } from '@domily/next'; export default definePage({ schema: 'domily.page/v1' });";
    expect(domilyNext().transform(localPage, '/src/todos.dmy.ts')).toBeNull();
    expect(domilyNext().transform(localPage, '/src/todos.ts')).toBeNull();
  });

  test('uses an injected text source codec for a non-JSON PageSpec suffix', () => {
    const codecs = createSourceCodecRegistry([toonFixtureCodec]);
    const transformed = domilyNext({ codecs }).transform('id: vite-toon', '/src/profile.dmy.toon?domily=page');

    expect(transformed).not.toBeNull();
    expect(transformed?.code).toContain('"id":"vite-toon"');
    expect(transformed?.code).toContain('export default page;');
  });

  test('uses the shared PageSpec normalizer when a manifest registry is supplied', () => {
    const registry = createPageRegistry();
    registry.registerComponentCatalog(nativeHtmlCatalog);

    expect(() => transformDomilyJsonModule(page, '/src/todos.dmy.json', { registry })).not.toThrow();
    expect(() => transformDomilyJsonModule(JSON.stringify({ ...JSON.parse(page), ui: { type: 'html.unknown' } }), '/src/bad.dmy.json', { registry }))
      .toThrow(DomilyVitePageError);
  });

  test('reports source positions for malformed JSON and validates configured extensions', () => {
    expect(() => transformDomilyJsonModule('{\n  "schema":\n}', '/src/bad.dmy.json')).toThrow(DomilyVitePageError);
    try {
      transformDomilyJsonModule('{\n  "schema":\n}', '/src/bad.dmy.json');
    } catch (error) {
      expect(error).toBeInstanceOf(DomilyVitePageError);
      const pageError = error as DomilyVitePageError;
      expect(pageError.code).toBe('json.syntax');
      expect(pageError.id).toBe('/src/bad.dmy.json');
      expect(pageError.loc?.line).toBe(3);
    }
    expect(() => domilyNext({ extensions: [] })).toThrow('extensions');
  });

  test('preserves injected codec diagnostics instead of treating non-JSON text as JSON', () => {
    const codecs = createSourceCodecRegistry([toonFixtureCodec]);

    expect(() => domilyNext({ codecs }).transform('invalid', '/src/bad.dmy.toon')).toThrow(DomilyVitePageError);
    try {
      domilyNext({ codecs }).transform('invalid', '/src/bad.dmy.toon');
    } catch (error) {
      expect(error).toBeInstanceOf(DomilyVitePageError);
      const pageError = error as DomilyVitePageError;
      expect(pageError.code).toBe('toon.syntax');
      expect(pageError.id).toBe('/src/bad.dmy.toon');
      expect(pageError.loc).toEqual({ column: 5, file: '/src/bad.dmy.toon', line: 2 });
    }
  });
});
