import { freezeDocument, type CodecIssue, type CodecRegistry, type Document } from '@domily/next-ast';
import {
  DocumentLoader,
  type DocumentFetcher,
  type DocumentStore,
  type DocumentEnvelope,
  type LoadedDocument,
  type VerifyEnvelope,
} from '@domily/next-loader';
import {
  DomRenderer,
  DomRendererError,
  type DomComponentRegistry,
} from '@domily/next-renderer-dom';
import {
  DocumentRuntime,
  RuntimeExecutionError,
  type RuntimeCapability,
  type RuntimeLimits,
  type RuntimeTrace,
  type RuntimeValue,
} from '@domily/next-runtime';
import { validateDocument, type ValidationResult } from '@domily/next-validator';

export type HostErrorPhase = 'load' | 'renderer' | 'revalidate' | 'runtime' | 'validation';

export interface HostErrorContext {
  document?: Document;
  error: unknown;
  phase: HostErrorPhase;
}

export interface RevalidationSkipContext {
  currentRevision: number;
  documentId: string;
  receivedRevision: number;
}

export interface MountedDomilyDocument {
  document: Document;
  envelope?: DocumentEnvelope;
  renderer: DomRenderer;
  revision?: number;
  runtime: DocumentRuntime;
  source: 'cache' | 'local' | 'network';
  stale: boolean;
}

export type RuntimePropsResolver = (document: Document) => RuntimeValue | undefined;

export interface DomilyDomHostOptions {
  autoApplyRevalidation?: boolean;
  capabilities?: ReadonlyMap<string, RuntimeCapability> | Readonly<Record<string, RuntimeCapability>>;
  codecs: CodecRegistry;
  components: DomComponentRegistry;
  document?: globalThis.Document;
  fetchEnvelope?: DocumentFetcher;
  limits?: Partial<RuntimeLimits>;
  now?: () => number;
  onDocumentMounted?: (document: MountedDomilyDocument) => void;
  onError?: (context: HostErrorContext) => void;
  onRevalidationSkipped?: (context: RevalidationSkipContext) => void;
  onTrace?: (trace: RuntimeTrace) => void;
  props?: RuntimePropsResolver | RuntimeValue;
  store: DocumentStore;
  verifyEnvelope?: VerifyEnvelope;
}

interface DocumentCandidate {
  document: Document;
  envelope?: DocumentEnvelope;
  source: MountedDomilyDocument['source'];
  stale: boolean;
}

/** A deterministic host composition failure with optional validator diagnostics. */
export class DomilyDomHostError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly issues: readonly CodecIssue[] = [],
  ) {
    super(message);
    this.name = 'DomilyDomHostError';
  }
}

/**
 * The browser app-shell integration point for Domily Next. It owns the only
 * supported composition path from delivery/local AST to a mounted DOM renderer.
 */
export class DomilyDomHost {
  private active: MountedDomilyDocument | undefined;
  private readonly capabilities: ReadonlyMap<string, RuntimeCapability>;
  private readonly capabilityNames: ReadonlySet<string>;
  private generation = 0;
  private readonly loader: DocumentLoader;
  private requestGeneration = 0;

  constructor(private readonly options: DomilyDomHostOptions) {
    this.capabilities = toCapabilityMap(options.capabilities);
    this.capabilityNames = new Set(this.capabilities.keys());
    this.loader = new DocumentLoader({
      codecs: options.codecs,
      ...(options.fetchEnvelope ? { fetchEnvelope: options.fetchEnvelope } : {}),
      ...(options.now ? { now: options.now } : {}),
      store: options.store,
      validate: (document) => this.validate(document),
      ...(options.verifyEnvelope ? { verifyEnvelope: options.verifyEnvelope } : {}),
    });
  }

  get current(): MountedDomilyDocument | undefined {
    return this.active;
  }

  async mount(id: string, root: HTMLElement): Promise<MountedDomilyDocument> {
    const requestGeneration = this.beginRequestGeneration();
    let loaded: LoadedDocument;
    try {
      loaded = await this.loader.load(id);
    } catch (error) {
      this.reportError('load', error);
      throw error;
    }
    try {
      this.assertCurrentRequest(requestGeneration);
      const generation = this.beginGeneration();
      const mounted = await this.activate(toCandidate(loaded), root, generation, requestGeneration);
      this.observeRevalidation(loaded, root, generation);
      return mounted;
    } catch (error) {
      this.reportError(errorPhase(error), error, loaded.document);
      throw error;
    }
  }

  async acceptAndMount(envelope: DocumentEnvelope, root: HTMLElement): Promise<MountedDomilyDocument> {
    const requestGeneration = this.beginRequestGeneration();
    let loaded: LoadedDocument;
    try {
      loaded = await this.loader.accept(envelope);
    } catch (error) {
      this.reportError('load', error);
      throw error;
    }
    try {
      this.assertCurrentRequest(requestGeneration);
      return await this.activate(toCandidate(loaded), root, this.beginGeneration(), requestGeneration);
    } catch (error) {
      this.reportError(errorPhase(error), error, loaded.document);
      throw error;
    }
  }

  async mountDocument(document: Document, root: HTMLElement): Promise<MountedDomilyDocument> {
    const requestGeneration = this.beginRequestGeneration();
    let frozen: Document;
    try {
      frozen = freezeDocument(document);
      const validation = this.validate(frozen);
      if (!validation.ok) {
        throw new DomilyDomHostError('host.validation.failed', 'Local document failed host validation.', validation.issues);
      }
    } catch (error) {
      this.reportError('validation', error, document);
      throw error;
    }
    try {
      this.assertCurrentRequest(requestGeneration);
      return await this.activate(
        { document: frozen, source: 'local', stale: false },
        root,
        this.beginGeneration(),
        requestGeneration,
      );
    } catch (error) {
      this.reportError(errorPhase(error), error, frozen);
      throw error;
    }
  }

  async unmount(): Promise<void> {
    this.beginRequestGeneration();
    this.beginGeneration();
    const current = this.active;
    if (!current) return;
    this.active = undefined;
    try {
      await current.renderer.unmount();
    } catch (error) {
      this.reportError('renderer', error, current.document);
      throw error;
    }
  }

  private async activate(
    candidate: DocumentCandidate,
    root: HTMLElement,
    generation: number,
    requestGeneration?: number,
  ): Promise<MountedDomilyDocument> {
    this.assertCurrentGeneration(generation);
    this.assertCurrentRequest(requestGeneration);
    const previous = this.active;
    if (previous) {
      this.active = undefined;
      try {
        await previous.renderer.unmount();
      } catch (error) {
        this.reportError('renderer', error, previous.document);
      }
    }
    this.assertCurrentGeneration(generation);
    this.assertCurrentRequest(requestGeneration);

    const props = this.resolveProps(candidate.document);
    const runtime = new DocumentRuntime(candidate.document, {
      capabilities: this.capabilities,
      ...(props === undefined ? {} : { props }),
      ...(this.options.limits ? { limits: this.options.limits } : {}),
      ...(this.options.onTrace ? { onTrace: this.options.onTrace } : {}),
    });
    const renderer = new DomRenderer(runtime, this.options.components, {
      ...(this.options.document ? { document: this.options.document } : {}),
      onError: (error) => this.reportError(errorPhase(error), error, candidate.document),
    });
    await renderer.mount(root);
    try {
      this.assertCurrentGeneration(generation);
      this.assertCurrentRequest(requestGeneration);
    } catch (error) {
      await renderer.unmount();
      throw error;
    }

    const mounted: MountedDomilyDocument = {
      document: candidate.document,
      ...(candidate.envelope ? { envelope: candidate.envelope, revision: candidate.envelope.revision } : {}),
      renderer,
      runtime,
      source: candidate.source,
      stale: candidate.stale,
    };
    this.active = mounted;
    this.notifyMounted(mounted);
    return mounted;
  }

  private observeRevalidation(loaded: LoadedDocument, root: HTMLElement, generation: number): void {
    if (this.options.autoApplyRevalidation === false || !loaded.revalidate) return;
    void loaded.revalidate.then(async (result) => {
      if (!result.ok) {
        this.reportError('revalidate', result.error, loaded.document);
        return;
      }
      const current = this.active;
      if (
        generation !== this.generation ||
        !current ||
        current.document.meta.id !== loaded.document.meta.id ||
        result.value.envelope.id !== current.document.meta.id
      ) {
        return;
      }
      const currentRevision = current.envelope?.revision;
      if (currentRevision === undefined || result.value.envelope.revision <= currentRevision) {
        this.notifyRevalidationSkipped({
          currentRevision: currentRevision ?? -1,
          documentId: loaded.document.meta.id,
          receivedRevision: result.value.envelope.revision,
        });
        return;
      }
      try {
        await this.activate(toCandidate(result.value), root, generation);
      } catch (error) {
        this.reportError(errorPhase(error), error, result.value.document);
      }
    });
  }

  private validate(document: Document): ValidationResult {
    return validateDocument(document, {
      capabilities: this.capabilityNames,
      components: this.options.components,
    });
  }

  private beginGeneration(): number {
    this.generation += 1;
    return this.generation;
  }

  private beginRequestGeneration(): number {
    this.requestGeneration += 1;
    return this.requestGeneration;
  }

  private assertCurrentGeneration(generation: number): void {
    if (generation !== this.generation) {
      throw new DomilyDomHostError('host.mount.superseded', 'Document mount was superseded by a newer request.');
    }
  }

  private assertCurrentRequest(requestGeneration: number | undefined): void {
    if (requestGeneration !== undefined && requestGeneration !== this.requestGeneration) {
      throw new DomilyDomHostError('host.mount.superseded', 'Document mount was superseded by a newer request.');
    }
  }

  private resolveProps(document: Document): RuntimeValue | undefined {
    if (typeof this.options.props === 'function') {
      return this.options.props(document);
    }
    return this.options.props;
  }

  private reportError(phase: HostErrorPhase, error: unknown, document?: Document): void {
    try {
      this.options.onError?.({ ...(document ? { document } : {}), error, phase });
    } catch {
      // Host diagnostics cannot change delivery, runtime, or renderer behavior.
    }
  }

  private notifyMounted(document: MountedDomilyDocument): void {
    try {
      this.options.onDocumentMounted?.(document);
    } catch {
      // Observers cannot invalidate a successful mount.
    }
  }

  private notifyRevalidationSkipped(context: RevalidationSkipContext): void {
    try {
      this.options.onRevalidationSkipped?.(context);
    } catch {
      // Diagnostics cannot alter document version selection.
    }
  }
}

function toCandidate(loaded: LoadedDocument): DocumentCandidate {
  return {
    document: loaded.document,
    envelope: loaded.envelope,
    source: loaded.source,
    stale: loaded.stale,
  };
}

function toCapabilityMap(
  capabilities: DomilyDomHostOptions['capabilities'],
): ReadonlyMap<string, RuntimeCapability> {
  if (!capabilities) return new Map();
  if (isReadonlyCapabilityMap(capabilities)) return new Map(capabilities);
  return new Map(Object.entries(capabilities));
}

function isReadonlyCapabilityMap(
  value: NonNullable<DomilyDomHostOptions['capabilities']>,
): value is ReadonlyMap<string, RuntimeCapability> {
  return typeof (value as ReadonlyMap<string, RuntimeCapability>).get === 'function' &&
    typeof (value as ReadonlyMap<string, RuntimeCapability>)[Symbol.iterator] === 'function';
}

function errorPhase(error: unknown): HostErrorPhase {
  if (error instanceof DomRendererError) return 'renderer';
  if (error instanceof RuntimeExecutionError) return 'runtime';
  if (error instanceof DomilyDomHostError && error.code === 'host.validation.failed') return 'validation';
  return 'runtime';
}
