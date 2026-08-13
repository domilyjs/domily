import { describe, expect, test } from 'bun:test';

import { createCodecRegistry, freezeDocument, type Document, type DocumentCodec } from '@domily/next-ast';

import {
  DocumentLoadError,
  DocumentLoader,
  MemoryDocumentStore,
  sha256ContentHash,
  type DocumentEnvelope,
} from '../src';

const document = freezeDocument({
  kind: 'document',
  protocol: 'domily-next',
  version: '0.1',
  meta: { id: 'todos', capabilities: [] },
  state: { kind: 'object', entries: {} },
  derived: {},
  actions: {},
  lifecycle: {},
  view: { kind: 'element', component: 'div', props: {}, events: {}, children: [] },
} satisfies Document);

function testCodec(): DocumentCodec {
  return {
    id: 'fixture',
    extensions: ['fixture'],
    mediaTypes: ['application/vnd.domily-fixture'],
    parse: (payload) =>
      payload === 'valid payload'
        ? { ok: true, value: document, issues: [] }
        : { ok: false, issues: [{ code: 'fixture.invalid', message: 'Invalid fixture payload.' }] },
    serialize: () => ({ ok: true, value: 'valid payload', issues: [] }),
  };
}

async function envelope(overrides: Partial<DocumentEnvelope> = {}): Promise<DocumentEnvelope> {
  const payload = overrides.payload ?? 'valid payload';
  return {
    id: 'todos',
    revision: 1,
    codec: 'fixture',
    contentHash: await sha256ContentHash(payload),
    issuedAt: '2026-08-13T00:00:00.000Z',
    cache: { maxAgeSeconds: 60, staleWhileRevalidateSeconds: 300 },
    payload,
    ...overrides,
  };
}

function createLoader(options: Partial<ConstructorParameters<typeof DocumentLoader>[0]> = {}) {
  const codecs = createCodecRegistry();
  codecs.register(testCodec());
  return new DocumentLoader({
    codecs,
    store: new MemoryDocumentStore(),
    validate: () => ({ ok: true, issues: [] }),
    now: () => 1_000,
    ...options,
  });
}

describe('document loader', () => {
  test('verifies, validates, and stores raw payload with its normalized AST', async () => {
    const loader = createLoader();
    const loaded = await loader.accept(await envelope());

    expect(loaded.source).toBe('network');
    expect(loaded.document).toBe(document);
    expect(Object.isFrozen(loaded.document)).toBe(true);
  });

  test('mounts a fresh cached document and revalidates it in the background', async () => {
    const initial = await envelope();
    const next = await envelope({ revision: 2 });
    let fetchCount = 0;
    const loader = createLoader({
      fetchEnvelope: async () => {
        fetchCount += 1;
        return next;
      },
    });
    await loader.accept(initial);

    const loaded = await loader.load('todos');
    expect(loaded.source).toBe('cache');
    expect(loaded.stale).toBe(false);
    expect(fetchCount).toBe(1);
    await expect(loaded.revalidate).resolves.toEqual(
      expect.objectContaining({ ok: true, value: expect.objectContaining({ envelope: next }) }),
    );
  });

  test('keeps the last verified cached document when a refresh fails in its stale window', async () => {
    const store = new MemoryDocumentStore();
    const cached = await envelope({ cache: { maxAgeSeconds: 1, staleWhileRevalidateSeconds: 60 } });
    const loader = createLoader({
      store,
      now: () => 1_000,
      fetchEnvelope: async () => {
        throw new Error('offline');
      },
    });
    await loader.accept(cached);

    const staleLoader = createLoader({
      store,
      now: () => 3_000,
      fetchEnvelope: async () => {
        throw new Error('offline');
      },
    });

    const loaded = await staleLoader.load('todos');
    expect(loaded).toMatchObject({ source: 'cache', stale: true, envelope: cached });
  });

  test('does not replace verified cache data when the envelope hash is invalid', async () => {
    const store = new MemoryDocumentStore();
    const loader = createLoader({ store });
    const valid = await envelope();
    await loader.accept(valid);
    const invalid = { ...valid, revision: 2, contentHash: 'sha256-invalid' };

    await expect(loader.accept(invalid)).rejects.toBeInstanceOf(DocumentLoadError);
    expect((await store.get('todos'))?.envelope).toEqual(valid);
  });

  test('does not accept a document rejected by host validation or signature policy', async () => {
    const invalidByHost = createLoader({ validate: () => ({ ok: false, issues: [{ code: 'host.denied', message: 'Denied.' }] }) });
    await expect(invalidByHost.accept(await envelope())).rejects.toMatchObject({
      issues: [{ code: 'host.denied', message: 'Denied.' }],
    });

    const invalidSignature = createLoader({ verifyEnvelope: () => false });
    await expect(invalidSignature.accept(await envelope())).rejects.toThrow('signature verification failed');
  });
});
