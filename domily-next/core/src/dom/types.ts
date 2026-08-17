import type {
  JsonValue,
  NormalizedPageSpec,
} from '../pagespec/types.ts';
import type {
  PageExtensionRuntimeRegistry,
  PageExtensionRuntimeRegistrySnapshot,
} from '../extensions/types.ts';
import type {
  PageRegistry,
  PageRegistrySnapshot,
  ScopeManifest,
} from '../registry/types.ts';

export type PageOrigin = 'local' | 'remote';

/** A host-owned value source; PageSpec never carries values or callbacks. */
export interface PageScopeProvider {
  /**
   * Marks a provider returned by a trusted extension runtime. PageHostOptions
   * only accepts ordinary host scopes; extension-owned providers are created
   * afresh for the active extension during each mount.
   */
  readonly extension?: string;
  readonly manifest: ScopeManifest;
  read(path: readonly string[]): JsonValue | undefined;
  subscribe?(listener: () => void): () => void;
  write?(path: readonly string[], value: JsonValue): void | Promise<void>;
}

export interface MutablePageScope extends PageScopeProvider {
  set(value: JsonValue): void;
}

export interface PageCapabilityContext {
  readonly event?: JsonValue;
  readonly origin: PageOrigin;
  readonly page: NormalizedPageSpec;
}

/** Trusted local implementation paired with a separately registered manifest. */
export interface PageCapabilityHandler {
  authorize?(context: PageCapabilityContext, args: JsonValue | undefined): boolean | Promise<boolean>;
  invoke(context: PageCapabilityContext, args: JsonValue | undefined): JsonValue | void | Promise<JsonValue | void>;
}

export interface DomComponentMountContext {
  readonly children: readonly Node[];
  readonly document: globalThis.Document;
  /** Stable PageSpec path for trusted renderers that need focus-safe descendants. */
  readonly nodeId: string;
  readonly props: Readonly<Record<string, JsonValue>>;
  readonly slots: Readonly<Record<string, readonly Node[]>>;
}

export interface DomComponentMount {
  readonly dispose?: () => void;
  readonly eventTarget?: EventTarget;
  readonly nodes: readonly Node[];
  readonly preventDefaultEvents?: readonly string[];
  projectEvent?(name: string, event: Event): JsonValue;
}

/** Trusted local DOM implementation. It is deliberately absent from Catalog manifest data. */
export interface TrustedDomComponentRenderer {
  readonly type: string;
  mount(context: DomComponentMountContext): DomComponentMount;
}

export interface DomComponentRendererRegistrySnapshot {
  get(type: string): TrustedDomComponentRenderer | undefined;
}

export interface DomComponentRendererRegistry extends DomComponentRendererRegistrySnapshot {
  register(renderer: TrustedDomComponentRenderer): void;
  snapshot(): DomComponentRendererRegistrySnapshot;
}

export type PageHostErrorPhase = 'event' | 'lifecycle' | 'mount' | 'render';

export interface PageHostErrorContext {
  readonly error: unknown;
  readonly page?: NormalizedPageSpec;
  readonly phase: PageHostErrorPhase;
}

export interface PageHostOptions {
  readonly capabilities?: ReadonlyMap<string, PageCapabilityHandler> | Readonly<Record<string, PageCapabilityHandler>>;
  readonly document?: globalThis.Document;
  /** Trusted local runtime implementations, separate from the JSON registry. */
  readonly extensionRuntimes?: PageExtensionRuntimeRegistry | PageExtensionRuntimeRegistrySnapshot;
  readonly onError?: (context: PageHostErrorContext) => void;
  readonly registry: PageRegistry;
  readonly renderers: DomComponentRendererRegistry;
  readonly scopes?: readonly PageScopeProvider[];
}

export type PageMountTarget = Element | string;

export interface PageMountOptions {
  readonly origin?: PageOrigin;
}

export interface PageHost {
  mount(input: unknown, target: PageMountTarget, options?: PageMountOptions): Promise<MountedPage>;
}

export interface MountedPage {
  readonly origin: PageOrigin;
  readonly page: NormalizedPageSpec;
  readonly registry: PageRegistrySnapshot;
  unmount(): Promise<void>;
}
