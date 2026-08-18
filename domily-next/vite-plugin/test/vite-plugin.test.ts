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
    if (payload.text === 'invalid-at-start') {
      return {
        ok: false,
        issues: [{
          code: 'toon.syntax',
          location: { column: 1, line: 1, offset: 0 },
          message: 'Fixture TOON starts with invalid syntax.',
        }],
      };
    }
    if (payload.text === 'prototype-key') {
      return {
        ok: true,
        issues: [],
        value: {
          payload,
          value: JSON.parse('{"schema":"domily.page/v1","id":"prototype-key","ui":{"type":"html.div"},"__proto__":{"polluted":true}}'),
        },
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
    const codecs = createSourceCodecRegistry([{
      ...toonFixtureCodec,
      extensions: ['dmy.ts'],
      id: 'typescript-fixture',
    }]);
    expect(domilyNext({ codecs }).transform(localPage, '/src/todos.dmy.ts')).toBeNull();
  });

  test('uses an injected text source codec for a non-JSON PageSpec suffix', () => {
    const codecs = createSourceCodecRegistry([toonFixtureCodec]);
    const transformed = domilyNext({ codecs }).transform('id: vite-toon', '/src/profile.dmy.toon?domily=page');

    expect(transformed).not.toBeNull();
    expect(transformed?.code).toContain('vite-toon');
    expect(transformed?.code).toContain('const page = JSON.parse(');
    expect(transformed?.code).toContain('export default page;');
  });

  test('restores codec output through JSON.parse so a JSON __proto__ key stays data', () => {
    const codecs = createSourceCodecRegistry([toonFixtureCodec]);
    const transformed = domilyNext({ codecs }).transform('prototype-key', '/src/prototype.dmy.toon');

    expect(transformed?.code).toContain('const page = JSON.parse(');
    const encoded = /const page = JSON\.parse\((.+)\);/.exec(transformed?.code ?? '')?.[1];
    expect(encoded).toBeDefined();
    const page = JSON.parse(JSON.parse(encoded ?? '"{}"')) as Record<string, unknown>;
    expect(Object.hasOwn(page, '__proto__')).toBe(true);
    expect(Object.getPrototypeOf(page)).toBe(Object.prototype);
    expect(page.__proto__).toEqual({ polluted: true });
  });

  test('rejects non-JSON codec values without evaluating accessors or silently dropping data', () => {
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    let accessorRead = false;
    const accessor = {};
    Object.defineProperty(accessor, 'value', {
      enumerable: true,
      get() {
        accessorRead = true;
        return 'must not run';
      },
    });
    const sparse = Array.from({ length: 3 }, (_, index) => index);
    Reflect.deleteProperty(sparse, 1);

    for (const value of [
      new Date(),
      () => undefined,
      { missing: undefined },
      accessor,
      cyclic,
      sparse,
      Object.assign([1], { '01': 'not-an-index' }),
    ]) {
      expectSerializationFailure(value);
    }
    expect(accessorRead).toBe(false);
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
    for (const source of ['{\r"schema":\r}', '{\r\n"schema":\r\n}']) {
      try {
        transformDomilyJsonModule(source, '/src/bad-newline.dmy.json');
      } catch (error) {
        expect(error).toBeInstanceOf(DomilyVitePageError);
        expect((error as DomilyVitePageError).loc).toEqual({
          column: 0,
          file: '/src/bad-newline.dmy.json',
          line: 3,
        });
      }
    }
    expect(() => domilyNext({ extensions: [] })).toThrow('extensions');
  });

  test('preserves injected codec diagnostics instead of treating non-JSON text as JSON', () => {
    const codecs = createSourceCodecRegistry([toonFixtureCodec]);

    expect(() => domilyNext({ codecs }).transform('invalid', '/src/bad.dmy.toon')).toThrow(DomilyVitePageError);
    expect(() => domilyNext({ codecs }).transform('invalid-at-start', '/src/first.dmy.toon')).toThrow(DomilyVitePageError);
    try {
      domilyNext({ codecs }).transform('invalid', '/src/bad.dmy.toon');
    } catch (error) {
      expect(error).toBeInstanceOf(DomilyVitePageError);
      const pageError = error as DomilyVitePageError;
      expect(pageError.code).toBe('toon.syntax');
      expect(pageError.id).toBe('/src/bad.dmy.toon');
      expect(pageError.loc).toEqual({ column: 4, file: '/src/bad.dmy.toon', line: 2 });
    }

    try {
      domilyNext({ codecs }).transform('invalid-at-start', '/src/first.dmy.toon');
    } catch (error) {
      expect(error).toBeInstanceOf(DomilyVitePageError);
      const pageError = error as DomilyVitePageError;
      expect(pageError.loc).toEqual({ column: 0, file: '/src/first.dmy.toon', line: 1 });
    }
  });
});

function sourceValueCodec(value: unknown): SourceCodec {
  return {
    extensions: ['dmy.value'],
    id: 'value-fixture',
    mediaTypes: ['text/x-domily-value-fixture'],
    parse(payload) {
      return {
        issues: [],
        ok: true,
        value: {
          payload,
          value: value as never,
        },
      };
    },
    version: '1.0.0',
  };
}

function expectSerializationFailure(value: unknown): void {
  const codecs = createSourceCodecRegistry([sourceValueCodec(value)]);
  try {
    domilyNext({ codecs }).transform('fixture', '/src/invalid.dmy.value');
    throw new Error('Expected codec output serialization to fail.');
  } catch (error) {
    expect(error).toBeInstanceOf(DomilyVitePageError);
    expect((error as DomilyVitePageError).code).toBe('vite.page.serialize.invalid');
  }
}
