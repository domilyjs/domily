import { clonePageEnvelopeCacheEntry } from './envelope.ts';
import type {
  PageEnvelopeCacheEntry,
  PageEnvelopeCacheVersion,
  PageEnvelopeStore,
} from './types.ts';

/**
 * A deterministic in-memory store for local development, tests, and hosts that
 * layer their own persistent storage beneath the delivery contract.
 */
export function createMemoryPageEnvelopeStore(): PageEnvelopeStore {
  const entries = new Map<string, PageEnvelopeCacheEntry>();
  return Object.freeze({
    compareAndSwap(
      namespace: string,
      documentId: string,
      expected: PageEnvelopeCacheVersion | undefined,
      entry: PageEnvelopeCacheEntry,
    ) {
      const key = cacheKey(namespace, documentId);
      const current = entries.get(key);
      if (!matchesVersion(current, expected)) return false;
      entries.set(key, clonePageEnvelopeCacheEntry(entry));
      return true;
    },
    delete(namespace: string, documentId: string) {
      entries.delete(cacheKey(namespace, documentId));
    },
    get(namespace: string, documentId: string) {
      const entry = entries.get(cacheKey(namespace, documentId));
      return entry ? clonePageEnvelopeCacheEntry(entry) : undefined;
    },
  });
}

function matchesVersion(
  entry: PageEnvelopeCacheEntry | undefined,
  expected: PageEnvelopeCacheVersion | undefined,
): boolean {
  if (!entry || !expected) return entry === undefined && expected === undefined;
  return entry.envelope.revision === expected.revision
    && entry.envelope.payloadHash === expected.payloadHash;
}

function cacheKey(namespace: string, documentId: string): string {
  return `${namespace}\u0000${documentId}`;
}
