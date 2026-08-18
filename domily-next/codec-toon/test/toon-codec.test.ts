import { describe, expect, test } from 'bun:test';

import {
  createPageDeliveryClient,
  hashPageEnvelopePayload,
  type PageEnvelope,
} from '@domily/next/delivery';
import { nativeHtmlCatalog } from '@domily/next/native-html';
import { normalizePageSpec } from '@domily/next/pagespec';
import {
  createPageRegistry,
  type CapabilityCatalogManifest,
} from '@domily/next/registry';
import {
  createToonSourceCodecRegistry,
  parseToonPage,
  serializeToonPage,
  TOON_CODEC_VERSION,
  toonPageCodec,
} from '../src/index.ts';

const toonFixture = await Bun.file(new URL('./fixtures/todo.dmy.toon', import.meta.url)).text();
const canonicalFixture = JSON.parse(
  await Bun.file(new URL('../../codec-fixtures/page-v1/todo.json', import.meta.url)).text(),
);
const initialTime = Date.parse('2026-08-17T00:00:00.000Z');

describe('TOON PageSpec codec', () => {
  test('parses the shared canonical fixture with an official-decoder root SourceMap', () => {
    const parsed = parseToonPage(toonFixture);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;

    expect(parsed.value.value).toEqual(canonicalFixture);
    expect(parsed.value.payload).toEqual({ kind: 'text', text: toonFixture });
    expect(parsed.value.sourceMap).toMatchObject({
      codecId: 'toon',
      nodes: {
        'toon:': {
          start: { column: 1, line: 1, offset: 0 },
          end: { offset: toonFixture.length },
        },
      },
    });
    expect(Object.keys(parsed.value.sourceMap?.nodes ?? {})).toEqual(['toon:']);
  });

  test('leaves PageSpec semantics to the shared core normalizer', () => {
    const parsed = parseToonPage(toonFixture);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;

    const normalized = normalizePageSpec(parsed.value.value, { registry: registry() });
    expect(normalized.ok).toBe(true);
    if (normalized.ok) {
      expect(normalized.value.ui.children?.[0]?.props?.value).toBe('$$literal-dollar');
    }
  });

  test('round trips canonical protocol data through the official encoder', () => {
    const serialized = serializeToonPage(canonicalFixture);
    expect(serialized.ok).toBe(true);
    if (!serialized.ok || serialized.value.kind !== 'text') return;

    expect(serialized.value.text).not.toContain('\r');
    const repeated = serializeToonPage(canonicalFixture);
    expect(repeated).toEqual(serialized);
    const reparsed = parseToonPage(serialized.value.text);
    expect(reparsed.ok).toBe(true);
    if (reparsed.ok) expect(reparsed.value.value).toEqual(canonicalFixture);
  });

  test('keeps generic JSON keys as data until PageSpec normalization applies policy', () => {
    const parsed = parseToonPage('__proto__: data\nconstructor: data\nprototype: data');
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;

    const value = parsed.value.value as Record<string, unknown>;
    expect(Object.getPrototypeOf(value)).toBeNull();
    expect(Object.hasOwn(value, '__proto__')).toBe(true);
    expect(value.__proto__).toBe('data');
    expect(value['constructor']).toBe('data');
    expect(value['prototype']).toBe('data');

    const serialized = serializeToonPage(parsed.value.value);
    expect(serialized.ok).toBe(true);
    if (!serialized.ok || serialized.value.kind !== 'text') return;
    const reparsed = parseToonPage(serialized.value.text);
    expect(reparsed.ok).toBe(true);
    if (reparsed.ok) expect(reparsed.value.value).toEqual(parsed.value.value);
  });

  test('reports official decoder failures without treating binary payloads as text', () => {
    const invalid = parseToonPage('items[2]:\n  - one');
    expect(invalid.ok).toBe(false);
    if (!invalid.ok) {
      expect(invalid.issues[0]).toMatchObject({
        code: 'toon.syntax',
        location: { column: 1, line: 2, offset: 10 },
      });
    }

    expect(toonPageCodec.parse({ kind: 'binary', bytes: new Uint8Array([1]) }))
      .toMatchObject({ ok: false, issues: [expect.objectContaining({ code: 'toon.payload.kind.invalid' })] });
  });

  test('delivers a TOON envelope through the same exact-codec and remote-policy boundary', async () => {
    const payload: PageEnvelope['payload'] = { kind: 'text', text: toonFixture };
    const source: PageEnvelope = {
      cache: { maxAgeSeconds: 60 },
      codec: { id: 'toon', mediaType: 'text/toon', version: TOON_CODEC_VERSION },
      documentId: 'json-todo',
      expiresAt: new Date(initialTime + 3_600_000).toISOString(),
      issuedAt: new Date(initialTime).toISOString(),
      pageSpec: 'domily.page/v1',
      payload,
      payloadHash: await hashPageEnvelopePayload(payload),
      revision: 1,
      schema: 'domily.envelope/v2',
    };
    const client = createPageDeliveryClient({
      allowUnsigned: true,
      cacheNamespace: 'toon-test',
      codecs: createToonSourceCodecRegistry(),
      now: () => initialTime,
      registry: registry(),
    });

    await expect(client.accept(source)).resolves.toMatchObject({
      page: { id: 'json-todo' },
      parsed: { sourceMap: { codecId: 'toon' } },
    });
  });
});

function registry() {
  const result = createPageRegistry();
  result.registerComponentCatalog(nativeHtmlCatalog);
  result.registerCapabilityCatalog(todosCapabilities);
  return result;
}

const todosCapabilities: CapabilityCatalogManifest = {
  schema: 'domily.capability-catalog/v1',
  id: '@test/todos',
  version: '1.0.0',
  capabilities: [{
    id: 'todos.save',
    version: '1.0.0',
    description: 'Saves a todo.',
    invocation: { localPage: true, remotePage: true },
  }],
};
