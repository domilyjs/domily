import { describe, expect, test } from 'bun:test';

import {
  createMemoryPageEnvelopeStore,
  createPageDeliveryClient,
  envelopeSignatureBytes,
  hashPageEnvelopePayload,
  type PageEnvelope,
  type PageEnvelopeCacheEntry,
  type PageEnvelopeCacheVersion,
  type PageEnvelopeStore,
} from '../../src/delivery/index.ts';
import { createPageExtensionRuntimeRegistry } from '../../src/extensions/index.ts';
import type { JsonValue, PageSpec } from '../../src/pagespec/index.ts';
import { nativeHtmlCatalog } from '../../src/native-html/index.ts';
import {
  createPageRegistry,
  type CapabilityCatalogManifest,
  type ExtensionManifest,
} from '../../src/registry/index.ts';
import type { SourceCodec, SourceMap } from '../../src/codec/index.ts';

const initialTime = Date.parse('2026-08-15T00:00:00.000Z');

function remotePage(overrides: Partial<PageSpec> = {}): PageSpec {
  return {
    schema: 'domily.page/v1',
    id: 'remote-page',
    requires: { catalogs: ['@domily/native-html'] },
    ui: { type: 'html.div', props: { className: 'remote' } },
    ...overrides,
  };
}

function createRegistry() {
  const registry = createPageRegistry();
  registry.registerComponentCatalog(nativeHtmlCatalog);
  return registry;
}

function codec(counter: { value: number }, binaryPage = remotePage()): SourceCodec {
  return {
    id: 'fixture',
    version: '1.0.0',
    extensions: ['dmy.fixture'],
    mediaTypes: ['application/vnd.domily-fixture'],
    parse(payload) {
      counter.value += 1;
      const value = payload.kind === 'text'
        ? JSON.parse(payload.text) as JsonValue
        : binaryPage as unknown as JsonValue;
      return { ok: true, value: { payload, value }, issues: [] };
    },
  };
}

function codecWithSourceMap(counter: { value: number }, sourceMap: unknown): SourceCodec {
  return {
    ...codec(counter),
    parse(payload) {
      counter.value += 1;
      return {
        ok: true,
        issues: [],
        value: {
          payload,
          sourceMap: sourceMap as SourceMap,
          value: payload.kind === 'text' ? JSON.parse(payload.text) as JsonValue : remotePage() as unknown as JsonValue,
        },
      };
    },
  };
}

async function envelope(
  payload: PageEnvelope['payload'],
  overrides: Partial<PageEnvelope> = {},
): Promise<PageEnvelope> {
  return {
    schema: 'domily.envelope/v2',
    documentId: 'remote-page',
    revision: 1,
    pageSpec: 'domily.page/v1',
    codec: { id: 'fixture', version: '1.0.0', mediaType: 'application/vnd.domily-fixture' },
    payload,
    payloadHash: await hashPageEnvelopePayload(payload),
    cache: { maxAgeSeconds: 60, staleWhileRevalidateSeconds: 60 },
    issuedAt: new Date(initialTime).toISOString(),
    expiresAt: new Date(initialTime + 3_600_000).toISOString(),
    ...overrides,
  };
}

function textPayload(page = remotePage()): PageEnvelope['payload'] {
  return { kind: 'text', text: JSON.stringify(page) };
}

describe('PageDeliveryClient', () => {
  test('exposes only compare-and-swap for memory-cache writes', () => {
    const store = createMemoryPageEnvelopeStore();
    expect('compareAndSwap' in store).toBe(true);
    expect('put' in store).toBe(false);
  });

  test('rejects unsigned remote envelopes by default and accepts only an explicit development opt-in', async () => {
    const counter = { value: 0 };
    const source = await envelope(textPayload());
    const common = {
      cacheNamespace: 'test',
      codecs: sourceRegistry(codec(counter)),
      now: () => initialTime,
      registry: createRegistry(),
    };

    await expect(createPageDeliveryClient(common).accept(source)).rejects.toMatchObject({
      code: 'delivery.envelope.signature.required',
    });
    expect(counter.value).toBe(0);

    const delivered = await createPageDeliveryClient({ ...common, allowUnsigned: true }).accept(source);
    expect(delivered.page.id).toBe('remote-page');
    expect(delivered.source).toBe('network');
    expect(counter.value).toBe(1);
  });

  test('binds raw payload and envelope metadata before any codec parser runs', async () => {
    const counter = { value: 0 };
    const source = await envelope(textPayload(), {
      signature: { algorithm: 'Ed25519', keyId: 'test-key', value: 'signature' },
    });
    const seen: Uint8Array[] = [];
    const client = createPageDeliveryClient({
      cacheNamespace: 'test',
      codecs: sourceRegistry(codec(counter)),
      now: () => initialTime,
      registry: createRegistry(),
      verifySignature(input) {
        seen.push(input.bytes);
        return true;
      },
    });

    await client.accept(source);
    expect(counter.value).toBe(1);
    expect(seen[0]).toEqual(envelopeSignatureBytes(source));

    const tampered = { ...source, payload: { kind: 'text' as const, text: `${source.payload.kind === 'text' ? source.payload.text : ''} ` } };
    await expect(client.accept(tampered)).rejects.toMatchObject({ code: 'delivery.envelope.hash.mismatch' });
    expect(counter.value).toBe(1);

    const differentRevision = { ...source, revision: 2 };
    expect(envelopeSignatureBytes(differentRevision)).not.toEqual(envelopeSignatureBytes(source));
    const binaryPayload = new TextEncoder().encode(source.payload.kind === 'text' ? source.payload.text : '');
    const differentPayloadKind = { ...source, payload: { kind: 'binary' as const, bytes: binaryPayload } };
    expect(envelopeSignatureBytes(differentPayloadKind)).not.toEqual(envelopeSignatureBytes(source));
  });

  test('requires an exact locally registered codec version and remote-safe manifest permissions', async () => {
    const counter = { value: 0 };
    const source = await envelope(textPayload());
    const client = createPageDeliveryClient({
      allowUnsigned: true,
      cacheNamespace: 'test',
      codecs: sourceRegistry(codec(counter)),
      now: () => initialTime,
      registry: createRegistry(),
    });
    await expect(client.accept({ ...source, codec: { ...source.codec, version: '2.0.0' } })).rejects.toMatchObject({
      code: 'delivery.codec.version.mismatch',
    });
    expect(counter.value).toBe(0);

    const registry = createRegistry();
    const privateCapability: CapabilityCatalogManifest = {
      schema: 'domily.capability-catalog/v1',
      id: '@test/private-capability',
      version: '1.0.0',
      capabilities: [{
        id: 'private.use',
        version: '1.0.0',
        description: 'Local-only capability.',
        invocation: { localPage: true, remotePage: false },
      }],
    };
    registry.registerCapabilityCatalog(privateCapability);
    const restricted = await envelope(textPayload(remotePage({
      requires: { catalogs: ['@domily/native-html'], capabilities: ['private.use'] },
    })));
    await expect(createPageDeliveryClient({
      allowUnsigned: true,
      cacheNamespace: 'test',
      codecs: sourceRegistry(codec(counter)),
      now: () => initialTime,
      registry,
    }).accept(restricted)).rejects.toMatchObject({ code: 'delivery.pagespec.invalid' });
  });

  test('defensively validates codec SourceMap identity, ranges, locations, and node ids', async () => {
    const counter = { value: 0 };
    const source = await envelope(textPayload());
    const common = {
      allowUnsigned: true,
      cacheNamespace: 'test',
      now: () => initialTime,
      registry: createRegistry(),
    };

    const wrongCodec = codecWithSourceMap(counter, {
      codecId: 'other-codec',
      nodes: {},
    });
    await expect(createPageDeliveryClient({ ...common, codecs: sourceRegistry(wrongCodec) }).accept(source))
      .rejects.toMatchObject({ code: 'delivery.codec.source-map.codec.mismatch' });

    const outsidePayload = codecWithSourceMap(counter, {
      codecId: 'fixture',
      nodes: {
        'fixture:/': {
          start: { column: 1, line: 1, offset: 0 },
          end: { column: 1, line: 1, offset: 1_000_000 },
        },
      },
    });
    await expect(createPageDeliveryClient({ ...common, codecs: sourceRegistry(outsidePayload) }).accept(source))
      .rejects.toMatchObject({ code: 'delivery.codec.source-map.offset.invalid' });

    const invertedRange = codecWithSourceMap(counter, {
      codecId: 'fixture',
      nodes: {
        'fixture:/': {
          start: { column: 8, line: 1, offset: 8 },
          end: { column: 4, line: 1, offset: 4 },
        },
      },
    });
    await expect(createPageDeliveryClient({ ...common, codecs: sourceRegistry(invertedRange) }).accept(source))
      .rejects.toMatchObject({ code: 'delivery.codec.source-map.range.invalid' });

    const zeroBasedTextLocation = codecWithSourceMap(counter, {
      codecId: 'fixture',
      nodes: {
        'fixture:/': {
          start: { column: 0, line: 0, offset: 0 },
          end: { column: 1, line: 1, offset: 1 },
        },
      },
    });
    await expect(createPageDeliveryClient({ ...common, codecs: sourceRegistry(zeroBasedTextLocation) }).accept(source))
      .rejects.toMatchObject({ code: 'delivery.codec.source-map.location.invalid' });

    const binarySource = await envelope({ kind: 'binary', bytes: new Uint8Array([1, 2, 3]) });
    const binaryMap = codecWithSourceMap(counter, {
      codecId: 'fixture',
      nodes: {
        'fixture:/': {
          start: { column: 0, line: 0, offset: 0 },
          end: { column: 0, line: 0, offset: 3 },
        },
      },
    });
    await expect(createPageDeliveryClient({ ...common, codecs: sourceRegistry(binaryMap) }).accept(binarySource))
      .resolves.toMatchObject({ page: { id: 'remote-page' } });

    const prototypeNamedNodes = Object.create(null) as Record<string, SourceMap['nodes'][string]>;
    Object.defineProperty(prototypeNamedNodes, '__proto__', {
      configurable: true,
      enumerable: true,
      value: {
        start: { column: 1, line: 1, offset: 0 },
        end: { column: 2, line: 1, offset: 1 },
      },
      writable: true,
    });
    const prototypeNamedMap = codecWithSourceMap(counter, {
      codecId: 'fixture',
      nodes: prototypeNamedNodes,
    });
    const delivered = await createPageDeliveryClient({ ...common, codecs: sourceRegistry(prototypeNamedMap) }).accept(source);
    expect(Object.getPrototypeOf(delivered.parsed.sourceMap?.nodes)).toBeNull();
    expect(Object.hasOwn(delivered.parsed.sourceMap?.nodes ?? {}, '__proto__')).toBe(true);

    const malformedSourceMap = codecWithSourceMap(counter, null);
    await expect(createPageDeliveryClient({ ...common, codecs: sourceRegistry(malformedSourceMap) }).accept(source))
      .rejects.toMatchObject({ code: 'delivery.codec.source-map.invalid' });

    let accessorRead = false;
    const accessorRange = {
      end: { column: 2, line: 1, offset: 1 },
    };
    Object.defineProperty(accessorRange, 'start', {
      enumerable: true,
      get() {
        accessorRead = true;
        return { column: 1, line: 1, offset: 0 };
      },
    });
    const accessorMap = codecWithSourceMap(counter, {
      codecId: 'fixture',
      nodes: { 'fixture:/': accessorRange },
    });
    await expect(createPageDeliveryClient({ ...common, codecs: sourceRegistry(accessorMap) }).accept(source))
      .rejects.toMatchObject({ code: 'delivery.codec.source-map.invalid' });
    expect(accessorRead).toBe(false);
  });

  test('re-parses cached raw payload, falls back to bounded stale cache, and keeps cache namespaces isolated', async () => {
    let now = initialTime;
    const counter = { value: 0 };
    const store = createMemoryPageEnvelopeStore();
    const source = await envelope(textPayload());
    const options = {
      allowUnsigned: true,
      codecs: sourceRegistry(codec(counter)),
      now: () => now,
      registry: createRegistry(),
      store,
    };
    const clientA = createPageDeliveryClient({ ...options, cacheNamespace: 'tenant-a' });
    const clientB = createPageDeliveryClient({ ...options, cacheNamespace: 'tenant-b' });

    await clientA.accept(source);
    expect(counter.value).toBe(1);
    const cached = await clientA.getCached('remote-page');
    expect(cached?.source).toBe('cache');
    expect(counter.value).toBe(2);
    expect(await clientB.getCached('remote-page')).toBeUndefined();

    now += 61_000;
    const stale = await clientA.load('remote-page', {
      async fetcher() {
        throw new Error('offline');
      },
    });
    expect(stale.source).toBe('stale-cache');
    expect(stale.stale).toBe(true);
    expect(counter.value).toBe(3);
  });

  test('derives cache freshness from signed envelope time instead of a mutable acceptedAt field', async () => {
    let now = initialTime;
    const counter = { value: 0 };
    let stored: PageEnvelopeCacheEntry | undefined;
    const store: PageEnvelopeStore = {
      compareAndSwap(_namespace, _documentId, expected, entry) {
        if (!matchesCacheVersion(stored, expected)) return false;
        stored = entry;
        return true;
      },
      delete() {
        stored = undefined;
      },
      get() {
        return stored
          ? { ...stored, acceptedAt: initialTime + 31_536_000_000 }
          : undefined;
      },
    };
    const client = createPageDeliveryClient({
      allowUnsigned: true,
      cacheNamespace: 'test',
      codecs: sourceRegistry(codec(counter)),
      now: () => now,
      registry: createRegistry(),
      store,
    });

    await client.accept(await envelope(textPayload()));
    now += 61_000;
    const stale = await client.getCached('remote-page');
    expect(stale?.source).toBe('stale-cache');
    now += 61_000;
    expect(await client.getCached('remote-page')).toBeUndefined();
  });

  test('does not let cache mutation, rollback, or a same-revision conflict replace a verified page', async () => {
    const counter = { value: 0 };
    let now = initialTime;
    let stored: PageEnvelopeCacheEntry | undefined;
    const unsafeStore: PageEnvelopeStore = {
      compareAndSwap(_namespace, _documentId, expected, entry) {
        if (!matchesCacheVersion(stored, expected)) return false;
        stored = entry;
        return true;
      },
      delete() {
        stored = undefined;
      },
      get() {
        return stored;
      },
    };
    const client = createPageDeliveryClient({
      allowUnsigned: true,
      cacheNamespace: 'test',
      codecs: sourceRegistry(codec(counter)),
      now: () => now,
      registry: createRegistry(),
      store: unsafeStore,
    });
    const binary = new Uint8Array([1, 2, 3]);
    const revisionTwo = await envelope({ kind: 'binary', bytes: binary }, {
      expiresAt: new Date(initialTime + 60_000).toISOString(),
      revision: 2,
    });
    await client.accept(revisionTwo);
    binary[0] = 99;
    expect((await client.getCached('remote-page'))?.envelope.payload).toEqual({ kind: 'binary', bytes: new Uint8Array([1, 2, 3]) });

    now += 61_000;
    expect(await client.getCached('remote-page')).toBeUndefined();
    const rollback = await envelope({ kind: 'binary', bytes: new Uint8Array([4]) }, {
      expiresAt: new Date(now + 60_000).toISOString(),
      issuedAt: new Date(now).toISOString(),
      revision: 1,
    });
    await expect(client.accept(rollback)).rejects.toMatchObject({ code: 'delivery.revision.rollback' });

    const conflict = await envelope({ kind: 'binary', bytes: new Uint8Array([5]) }, {
      expiresAt: new Date(now + 60_000).toISOString(),
      issuedAt: new Date(now).toISOString(),
      revision: 2,
    });
    await expect(client.accept(conflict)).rejects.toMatchObject({ code: 'delivery.revision.conflict' });

    if (!stored || stored.envelope.payload.kind !== 'binary') throw new Error('Missing binary cache entry.');
    stored.envelope.payload.bytes[0] = 42;
    expect(await client.getCached('remote-page')).toBeUndefined();
  });

  test('serializes concurrent persistence so a lower revision cannot win the final write', async () => {
    const counter = { value: 0 };
    let stored: PageEnvelopeCacheEntry | undefined;
    let signalLowerPut: (() => void) | undefined;
    let signalHigherCompare: (() => void) | undefined;
    let releaseLowerPut: (() => void) | undefined;
    const lowerPutStarted = new Promise<void>((resolve) => {
      signalLowerPut = resolve;
    });
    const releaseLower = new Promise<void>((resolve) => {
      releaseLowerPut = resolve;
    });
    const higherCompareStarted = new Promise<void>((resolve) => {
      signalHigherCompare = resolve;
    });
    const store: PageEnvelopeStore = {
      async compareAndSwap(_namespace, _documentId, expected, entry) {
        if (entry.envelope.revision === 1) {
          signalLowerPut?.();
          await releaseLower;
        }
        if (entry.envelope.revision === 2) {
          signalHigherCompare?.();
        }
        if (!matchesCacheVersion(stored, expected)) return false;
        stored = entry;
        return true;
      },
      delete() {
        stored = undefined;
      },
      get() {
        return stored;
      },
    };
    const client = createPageDeliveryClient({
      allowUnsigned: true,
      cacheNamespace: 'test',
      codecs: sourceRegistry(codec(counter)),
      now: () => initialTime,
      registry: createRegistry(),
      store,
    });
    const lower = await envelope(textPayload(remotePage({ ui: { type: 'html.div', props: { className: 'lower' } } })), { revision: 1 });
    const higher = await envelope(textPayload(remotePage({ ui: { type: 'html.div', props: { className: 'higher' } } })), { revision: 2 });

    const lowerResult = client.accept(lower);
    await lowerPutStarted;
    const higherResult = client.accept(higher);
    await higherCompareStarted;
    releaseLowerPut?.();
    const results = await Promise.allSettled([lowerResult, higherResult]);

    expect(results[0]?.status).toBe('rejected');
    expect(results[1]?.status).toBe('fulfilled');
    expect((await client.getCached('remote-page'))?.envelope.revision).toBe(2);
  });

  test('requires deployed extension runtime availability without executing activation during delivery', async () => {
    const counter = { value: 0 };
    const registry = createRegistry();
    const extension: ExtensionManifest = {
      schema: 'domily.extension/v1',
      id: '@test/draft',
      version: '1.0.0',
      description: 'Declares the local draft contract.',
      delivery: { remotePage: true },
      config: { type: 'object', additionalProperties: false },
      scopes: [{ name: 'draft', mode: 'read', value: { type: 'object', additionalProperties: true } }],
    };
    registry.registerExtension(extension);
    const scopedPage = remotePage({
      requires: { catalogs: ['@domily/native-html'], extensions: ['@test/draft'] },
      extensions: { '@test/draft': {} },
      ui: { type: 'html.text', props: { value: '$draft.title' } },
    });
    const source = await envelope(textPayload(scopedPage));
    const extensionScope = extension.scopes?.[0];
    if (!extensionScope) throw new Error('Missing extension scope.');
    let activations = 0;
    const extensionRuntimes = createPageExtensionRuntimeRegistry([{
      id: extension.id,
      version: extension.version,
      allowRemote: true,
      scopes: extension.scopes,
      activate() {
        activations += 1;
        return {};
      },
    }]);
    const base = {
      allowUnsigned: true,
      cacheNamespace: 'test',
      codecs: sourceRegistry(codec(counter)),
      now: () => initialTime,
      registry,
    };
    await expect(createPageDeliveryClient(base).accept(source)).rejects.toMatchObject({ code: 'delivery.extension.runtime.missing' });
    const delivered = await createPageDeliveryClient({ ...base, extensionRuntimes }).accept(source);
    expect(delivered.page.id).toBe('remote-page');
    expect(activations).toBe(0);
    await expect(createPageDeliveryClient({
      ...base,
      extensionRuntimes,
      scopes: [{ manifest: extensionScope }],
    }).accept(source)).rejects.toMatchObject({ code: 'delivery.pagespec.invalid' });
    expect(activations).toBe(0);
    const unactivated = await envelope(textPayload(remotePage({
      ui: { type: 'html.text', props: { value: '$draft.title' } },
    })));
    await expect(createPageDeliveryClient({ ...base, extensionRuntimes }).accept(unactivated)).rejects.toMatchObject({
      code: 'delivery.pagespec.invalid',
    });
    const wrongId = await envelope(textPayload({ ...scopedPage, id: 'different-page' }));
    await expect(createPageDeliveryClient({ ...base, extensionRuntimes }).accept(wrongId)).rejects.toMatchObject({
      code: 'delivery.page.id.mismatch',
    });
    const localOnlyRuntime = createPageExtensionRuntimeRegistry([{
      id: extension.id,
      version: extension.version,
      allowRemote: false,
      scopes: extension.scopes,
      activate() {
        return {};
      },
    }]);
    await expect(createPageDeliveryClient({ ...base, extensionRuntimes: localOnlyRuntime }).accept(source)).rejects.toMatchObject({
      code: 'delivery.extension.runtime.remote.disallowed',
    });
  });
});

function sourceRegistry(...codecs: SourceCodec[]) {
  return {
    byExtension() {
      return undefined;
    },
    byId(id: string) {
      return codecs.find((candidate) => candidate.id === id);
    },
    byMediaType() {
      return undefined;
    },
    register() {
      throw new Error('Test source registry is read-only.');
    },
  };
}

function matchesCacheVersion(
  entry: PageEnvelopeCacheEntry | undefined,
  expected: PageEnvelopeCacheVersion | undefined,
): boolean {
  if (!entry || !expected) return entry === undefined && expected === undefined;
  return entry.envelope.payloadHash === expected.payloadHash
    && entry.envelope.revision === expected.revision;
}
