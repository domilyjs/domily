import type { PageScopeProvider } from '../dom/types.ts';
import type { JsonValue } from '../pagespec/types.ts';
import type { PageRegistrySnapshot, ScopeManifest } from '../registry/types.ts';

/** Metadata that delivery may inspect without ever executing extension code. */
export interface PageExtensionRuntimeAvailabilityEntry {
  readonly allowRemote: boolean;
  readonly id: string;
  readonly scopes: readonly ScopeManifest[];
  readonly version: string;
}

/** Read-only local deployment view used by PageHost and PageDeliveryClient. */
export interface PageExtensionRuntimeAvailability {
  get(id: string): PageExtensionRuntimeAvailabilityEntry | undefined;
}

/** Data supplied to trusted local code after PageSpec normalization. */
export interface PageExtensionActivationContext {
  readonly config: JsonValue;
  readonly id: string;
  readonly origin: 'local' | 'remote';
  readonly pageId: string;
  readonly registry: PageRegistrySnapshot;
  readonly version: string;
}

/** Per-mount resources produced by one trusted extension runtime. */
export interface PageExtensionActivation {
  readonly dispose?: () => void | Promise<void>;
  readonly scopes?: readonly PageScopeProvider[];
}

/**
 * Trusted code registered by the application, never supplied by PageSpec or
 * an envelope. M5 activation is synchronous so mount cancellation and
 * cleanup remain deterministic.
 */
export interface TrustedPageExtensionRuntime {
  /** Defaults to false; remote activation needs this and manifest permission. */
  readonly allowRemote?: boolean;
  activate(context: PageExtensionActivationContext): PageExtensionActivation;
  readonly id: string;
  /** Defaults to an empty list and must match the registered manifest. */
  readonly scopes?: readonly ScopeManifest[];
  readonly version: string;
}

/** Immutable registration snapshot, including normalized optional metadata. */
export interface RegisteredPageExtensionRuntime extends PageExtensionRuntimeAvailabilityEntry {
  activate(context: PageExtensionActivationContext): PageExtensionActivation;
}

/** Immutable snapshot used by a single mount or delivery validation. */
export interface PageExtensionRuntimeRegistrySnapshot extends PageExtensionRuntimeAvailability {
  get(id: string): RegisteredPageExtensionRuntime | undefined;
}

/** Mutable application-startup registry for trusted extension runtimes. */
export interface PageExtensionRuntimeRegistry extends PageExtensionRuntimeRegistrySnapshot {
  register(runtime: TrustedPageExtensionRuntime): void;
  snapshot(): PageExtensionRuntimeRegistrySnapshot;
}
