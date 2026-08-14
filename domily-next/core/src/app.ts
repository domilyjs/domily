import type { Document } from './ast/index.ts';
import { createCodecRegistry, type CodecRegistry } from './codec/index.ts';
import {
  DomilyDomHost,
  type DomilyDomHostOptions,
  type MountedDomilyDocument,
} from './dom-host/index.ts';
import {
  IndexedDbDocumentStore,
  MemoryDocumentStore,
  type DocumentEnvelope,
  type DocumentStore,
} from './loader/index.ts';
import { createMvpDomRegistry, type DomComponentRegistry } from './renderer-dom/index.ts';
import type { CapabilityContext, RuntimeCapability, RuntimeValue } from './runtime/index.ts';

/**
 * Convenience handlers receive decoded JSON values directly. Production
 * backends remain responsible for their own authentication and validation.
 */
export type DomilyCapabilityHandler = (
  args: any,
  context: CapabilityContext,
) => unknown | Promise<unknown>;

export type DomilyCapabilityContext = CapabilityContext;
export type DomilyCapabilityDefinition = DomilyCapabilityHandler | RuntimeCapability;
export type DomilyCapabilities = Readonly<Record<string, DomilyCapabilityDefinition>>;
export type DomilyMountTarget = HTMLElement | string;

export type DomilyAppOptions = Omit<
  DomilyDomHostOptions,
  'capabilities' | 'codecs' | 'components' | 'store'
> & {
  capabilities?: DomilyCapabilities;
  codecs?: CodecRegistry;
  components?: DomComponentRegistry;
  store?: DocumentStore;
};

/** A deterministic failure raised by the public app convenience layer. */
export class DomilyAppError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'DomilyAppError';
  }
}

/**
 * Public app facade. It owns the default registry and cache selection. Concrete
 * delivery codecs live in independent packages and every document still
 * delegates to DomilyDomHost for final validation/mounting.
 */
export class DomilyApp {
  private readonly host: DomilyDomHost;

  constructor(options: DomilyAppOptions = {}) {
    const {
      capabilities,
      codecs = createCodecRegistry(),
      components = createMvpDomRegistry(),
      store = createDefaultStore(),
      ...hostOptions
    } = options;
    this.host = new DomilyDomHost({
      ...hostOptions,
      capabilities: toRuntimeCapabilities(capabilities),
      codecs,
      components,
      store,
    });
  }

  get current(): MountedDomilyDocument | undefined {
    return this.host.current;
  }

  async mount(document: Document, target: DomilyMountTarget): Promise<MountedDomilyDocument> {
    return this.host.mountDocument(document, resolveTarget(target));
  }

  async mountRemote(id: string, target: DomilyMountTarget): Promise<MountedDomilyDocument> {
    return this.host.mount(id, resolveTarget(target));
  }

  async accept(envelope: DocumentEnvelope, target: DomilyMountTarget): Promise<MountedDomilyDocument> {
    return this.host.acceptAndMount(envelope, resolveTarget(target));
  }

  async unmount(): Promise<void> {
    await this.host.unmount();
  }
}

export function createDomilyApp(options: DomilyAppOptions = {}): DomilyApp {
  return new DomilyApp(options);
}

/** Marks an ergonomic handler record as a Domily capability registry. */
export function defineCapabilities<const T extends DomilyCapabilities>(capabilities: T): T {
  return capabilities;
}

function createDefaultStore(): DocumentStore {
  return typeof globalThis.indexedDB === 'undefined'
    ? new MemoryDocumentStore()
    : new IndexedDbDocumentStore();
}

function resolveTarget(target: DomilyMountTarget): HTMLElement {
  if (typeof target !== 'string') return target;
  const root = globalThis.document?.querySelector<HTMLElement>(target);
  if (!root) {
    throw new DomilyAppError('app.mount.target', `Could not find Domily mount target "${target}".`);
  }
  return root;
}

function toRuntimeCapabilities(capabilities: DomilyCapabilities | undefined): Record<string, RuntimeCapability> {
  return Object.fromEntries(
    Object.entries(capabilities ?? {}).map(([name, definition]) => [
      name,
      typeof definition === 'function'
        ? {
            execute: async (args, context) => (await definition(args, context)) as RuntimeValue,
          }
        : definition,
    ]),
  );
}
