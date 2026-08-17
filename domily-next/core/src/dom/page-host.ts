import {
  materializeTemplate,
  parseBindingPath,
  readBindingPath,
  type BindingPath,
} from '../pagespec/binding.ts';
import {
  extensionScopeContractsMatch,
  scopeContractMatches,
} from '../extensions/registry.ts';
import type {
  PageExtensionActivation,
  PageExtensionRuntimeRegistrySnapshot,
  RegisteredPageExtensionRuntime,
} from '../extensions/types.ts';
import { normalizePageSpec } from '../pagespec/normalize.ts';
import type {
  CapabilityInvocation,
  JsonValue,
  NormalizedPageSpec,
  PageSpecIssue,
  UiNode,
} from '../pagespec/types.ts';
import { validateJsonSchema } from '../registry/schema.ts';
import type { PageRegistrySnapshot, ScopeManifest } from '../registry/types.ts';
import { createPageRenderer, type PageRenderer } from './page-renderer.ts';
import { cloneDomJson } from './value.ts';
import type {
  DomComponentRendererRegistrySnapshot,
  MountedPage,
  PageCapabilityContext,
  PageCapabilityHandler,
  PageHost,
  PageHostErrorContext,
  PageHostErrorPhase,
  PageHostOptions,
  PageMountOptions,
  PageMountTarget,
  PageOrigin,
  PageScopeProvider,
} from './types.ts';

export class PageHostError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly issues?: readonly PageSpecIssue[],
    readonly causeValue?: unknown,
  ) {
    super(message);
    this.name = 'PageHostError';
  }
}

interface ScopeSnapshot {
  readonly manifest: ScopeManifest;
  readonly provider: PageScopeProvider;
}

interface ActiveExtension {
  readonly activation: PageExtensionActivation;
  readonly id: string;
}

interface ActivatedExtensions {
  readonly extensions: readonly ActiveExtension[];
  readonly releaseScopes: () => void;
  readonly scopes: ReadonlyMap<string, ScopeSnapshot>;
}

/** Creates the native JS/TS host for normalized PageSpec documents. */
export function createPageHost(options: PageHostOptions): PageHost {
  return new DomilyPageHost(options);
}

class DomilyPageHost implements PageHost {
  private readonly activeExtensionScopeProviders = new Set<PageScopeProvider>();
  private readonly capabilities: ReadonlyMap<string, PageCapabilityHandler>;
  private readonly scopeProviders: readonly PageScopeProvider[];

  constructor(private readonly options: PageHostOptions) {
    this.capabilities = snapshotCapabilities(options.capabilities);
    this.scopeProviders = [...(options.scopes ?? [])];
  }

  async mount(input: unknown, target: PageMountTarget, mountOptions: PageMountOptions = {}): Promise<MountedPage> {
    const origin = mountOptions.origin ?? 'local';
    const document = this.options.document ?? globalThis.document;
    const root = resolveTarget(target, document);
    const registry = this.options.registry.snapshot();
    const renderers = this.options.renderers.snapshot();
    const hostScopes = snapshotHostScopes(this.scopeProviders);
    const extensionRuntimes = snapshotExtensionRuntimes(this.options.extensionRuntimes);
    const normalized = normalizePageSpec(input, {
      origin,
      registry,
      // Extension-owned scopes are deliberately absent here. The normalizer
      // exposes their contract only after the PageSpec enables the extension.
      scopes: publicScopeManifests(hostScopes),
    });
    if (!normalized.ok) {
      const error = new PageHostError('dom.page.invalid', 'PageSpec validation failed before mount.', normalized.issues);
      this.reportError(error, 'mount');
      throw error;
    }
    const page = normalized.value;

    let active = false;
    let committed = false;
    let phase: PageHostErrorPhase = 'mount';
    let renderer: PageRenderer | undefined;
    let unsubscribe: (() => void) | undefined;
    let extensions: readonly ActiveExtension[] = [];
    let releaseExtensionScopes: (() => void) | undefined;
    try {
      const activated = await activateExtensions(
        page,
        origin,
        registry,
        extensionRuntimes,
        this.activeExtensionScopeProviders,
      );
      extensions = activated.extensions;
      releaseExtensionScopes = activated.releaseScopes;
      const scopes = mergeScopeSnapshots(hostScopes, activated.scopes);
      preflightPage(page, registry, renderers, this.capabilities, scopes);
      active = true;
      const resolveScope = (path: BindingPath): JsonValue | undefined => readScope(scopes, path);
      const writeScope = async (path: BindingPath, value: JsonValue): Promise<void> => {
        await writeScopeValue(scopes, path, value);
      };
      const invoke = async (invocation: CapabilityInvocation, event?: JsonValue): Promise<void> => {
        await invokeCapability({
          capabilities: this.capabilities,
          event,
          invocation,
          origin,
          page,
          registry,
          resolveScope,
        });
      };
      const pageRenderer = createPageRenderer({
        dispatch: async (invocation, event) => {
          if (!active) {
            throw new PageHostError('dom.page.inactive', 'The page has already been unmounted.');
          }
          await invoke(invocation, event);
        },
        document,
        page,
        registry,
        renderers,
        reportError: (error) => this.reportError(error, 'event', page),
        resolveScope,
        target: root,
        writeScope,
      });
      renderer = pageRenderer;

      pageRenderer.render();
      committed = true;
      unsubscribe = subscribeScopes(scopes, () => {
        if (!active) {
          return;
        }
        try {
          pageRenderer.render();
        } catch (error) {
          this.reportError(error, 'render', page);
        }
      });

      if (page.lifecycle?.mounted) {
        phase = 'lifecycle';
        await invoke(page.lifecycle.mounted);
      }

      return createMountedPage({
        invoke,
        onError: (error) => this.reportError(error, 'lifecycle', page),
        origin,
        page,
        registry,
        renderer: pageRenderer,
        root,
        stop: async () => {
          active = false;
          unsubscribe?.();
          try {
            await disposeExtensions(extensions);
          } finally {
            releaseExtensionScopes?.();
            releaseExtensionScopes = undefined;
          }
        },
      });
    } catch (error) {
      active = false;
      try {
        unsubscribe?.();
      } catch {
        // A failed subscription must not prevent renderer cleanup.
      }
      try {
        renderer?.dispose();
      } catch {
        // Renderer disposal is diagnostic-only during a failed mount.
      }
      try {
        await disposeExtensions(extensions);
      } catch {
        // The initial mount error remains the useful failure diagnostic.
      } finally {
        releaseExtensionScopes?.();
        releaseExtensionScopes = undefined;
      }
      if (committed) {
        root.replaceChildren();
      }
      this.reportError(error, phase, page);
      throw error;
    }
  }

  private reportError(error: unknown, phase: PageHostErrorPhase, page?: NormalizedPageSpec): void {
    const callback = this.options.onError;
    if (!callback) {
      return;
    }
    const context: PageHostErrorContext = { error, ...(page ? { page } : {}), phase };
    try {
      callback(context);
    } catch {
      // Host error observers are diagnostic-only and never affect page execution.
    }
  }
}

function createMountedPage(input: {
  readonly invoke: (invocation: CapabilityInvocation, event?: JsonValue) => Promise<void>;
  readonly onError: (error: unknown) => void;
  readonly origin: PageOrigin;
  readonly page: NormalizedPageSpec;
  readonly registry: PageRegistrySnapshot;
  readonly renderer: PageRenderer;
  readonly root: Element;
  readonly stop: () => Promise<void>;
}): MountedPage {
  let unmountPromise: Promise<void> | undefined;
  return Object.freeze({
    origin: input.origin,
    page: input.page,
    registry: input.registry,
    unmount(): Promise<void> {
      unmountPromise ??= unmountPage(input);
      return unmountPromise;
    },
  });
}

async function unmountPage(input: Parameters<typeof createMountedPage>[0]): Promise<void> {
  let unmountError: unknown;
  try {
    if (input.page.lifecycle?.unmounted) {
      await input.invoke(input.page.lifecycle.unmounted);
    }
  } catch (error) {
    unmountError = error;
    input.onError(error);
  }
  try {
    input.renderer.dispose();
  } catch (error) {
    unmountError ??= error;
    input.onError(error);
  }
  try {
    await input.stop();
  } catch (error) {
    unmountError ??= error;
    input.onError(error);
  } finally {
    input.root.replaceChildren();
  }
  if (unmountError) {
    throw unmountError;
  }
}

function snapshotCapabilities(
  input: PageHostOptions['capabilities'],
): ReadonlyMap<string, PageCapabilityHandler> {
  const entries = input instanceof Map ? [...input.entries()] : Object.entries(input ?? {});
  const output = new Map<string, PageCapabilityHandler>();
  for (const [id, handler] of entries) {
    if (!id || typeof handler !== 'object' || handler === null || typeof handler.invoke !== 'function') {
      throw new PageHostError('dom.capability.handler.invalid', `Capability handler "${id}" requires invoke().`);
    }
    if (handler.authorize !== undefined && typeof handler.authorize !== 'function') {
      throw new PageHostError('dom.capability.authorize.invalid', `Capability handler "${id}" has an invalid authorize().`);
    }
    output.set(id, handler);
  }
  return output;
}

function snapshotHostScopes(providers: readonly PageScopeProvider[]): ReadonlyMap<string, ScopeSnapshot> {
  const scopes = new Map<string, ScopeSnapshot>();
  for (const provider of providers) {
    const snapshot = snapshotScope(provider);
    if (provider.extension !== undefined) {
      throw new PageHostError(
        'dom.scope.extension.static.disallowed',
        `Extension-owned scope "$${snapshot.manifest.name}" must be created by its runtime for each mount.`,
      );
    }
    const manifest = snapshot.manifest;
    if (scopes.has(manifest.name)) {
      throw new PageHostError('dom.scope.duplicate', `Scope "$${manifest.name}" is provided more than once.`);
    }
    scopes.set(manifest.name, snapshot);
  }
  return scopes;
}

function publicScopeManifests(scopes: ReadonlyMap<string, ScopeSnapshot>): readonly ScopeManifest[] {
  return [...scopes.values()].map((scope) => scope.manifest);
}

function snapshotScope(provider: PageScopeProvider): ScopeSnapshot {
  if (!provider || typeof provider.read !== 'function' || !provider.manifest) {
    throw new PageHostError('dom.scope.provider.invalid', 'Each PageScopeProvider requires a manifest and read().');
  }
  const manifest = cloneScopeManifest(provider.manifest);
  if (!/^[A-Za-z][A-Za-z0-9_-]*$/.test(manifest.name) || ['__proto__', 'constructor', 'prototype'].includes(manifest.name)) {
    throw new PageHostError('dom.scope.name.invalid', `Scope "${manifest.name}" has an invalid name.`);
  }
  if (manifest.mode !== 'read' && manifest.mode !== 'readwrite') {
    throw new PageHostError('dom.scope.mode.invalid', `Scope "$${manifest.name}" has an invalid mode.`);
  }
  if (manifest.mode === 'readwrite' && typeof provider.write !== 'function') {
    throw new PageHostError('dom.scope.write.unavailable', `Readwrite scope "$${manifest.name}" requires write().`);
  }
  if (provider.extension !== undefined
    && (typeof provider.extension !== 'string' || provider.extension.trim().length === 0 || /\s/.test(provider.extension))) {
    throw new PageHostError('dom.scope.extension.invalid', `Scope "$${manifest.name}" has an invalid extension owner.`);
  }
  return { manifest, provider };
}

function mergeScopeSnapshots(
  hostScopes: ReadonlyMap<string, ScopeSnapshot>,
  extensionScopes: ReadonlyMap<string, ScopeSnapshot>,
): ReadonlyMap<string, ScopeSnapshot> {
  const merged = new Map(hostScopes);
  for (const [name, scope] of extensionScopes) {
    if (merged.has(name)) {
      throw new PageHostError('dom.scope.duplicate', `Scope "$${name}" is provided more than once.`);
    }
    merged.set(name, scope);
  }
  return merged;
}

function snapshotExtensionRuntimes(
  input: PageHostOptions['extensionRuntimes'],
): PageExtensionRuntimeRegistrySnapshot | undefined {
  if (!input) {
    return undefined;
  }
  const snapshot = 'snapshot' in input && typeof input.snapshot === 'function'
    ? input.snapshot()
    : input;
  if (!snapshot || typeof snapshot.get !== 'function') {
    throw new PageHostError('dom.extension.runtime.registry.invalid', 'Extension runtimes must provide get() or snapshot().');
  }
  return snapshot;
}

async function activateExtensions(
  page: NormalizedPageSpec,
  origin: PageOrigin,
  registry: PageRegistrySnapshot,
  runtimes: PageExtensionRuntimeRegistrySnapshot | undefined,
  activeScopeProviders: Set<PageScopeProvider>,
): Promise<ActivatedExtensions> {
  const extensions: ActiveExtension[] = [];
  const scopes = new Map<string, ScopeSnapshot>();
  let releaseScopes: (() => void) | undefined;
  try {
    for (const requirement of page.requires.extensions) {
      const extension = registry.resolveExtension(requirement);
      if (!extension) {
        throw new PageHostError('dom.extension.unresolved', `Extension "${requirement.id}" disappeared from this registry snapshot.`);
      }
      const runtime = runtimes?.get(extension.manifest.id);
      assertRuntimeCompatible(runtime, extension.manifest.id, extension.manifest.version, extension.manifest.scopes ?? [], origin);
      const config = page.extensions?.[extension.manifest.id];
      if (config === undefined) {
        throw new PageHostError(
          'dom.extension.config.missing',
          `Extension "${extension.manifest.id}" has no normalized configuration.`,
        );
      }
      let activation: PageExtensionActivation;
      try {
        activation = runtime.activate(Object.freeze({
          config,
          id: extension.manifest.id,
          origin,
          pageId: page.id,
          registry,
          version: extension.manifest.version,
        }));
      } catch (error) {
        throw new PageHostError(
          'dom.extension.activate.failed',
          `Extension runtime "${extension.manifest.id}" failed to activate.`,
          undefined,
          error,
        );
      }
      if (isPromiseLike(activation)) {
        throw new PageHostError(
          'dom.extension.activate.async.disallowed',
          `Extension runtime "${extension.manifest.id}" must activate synchronously.`,
        );
      }
      // Retain the activation before scope validation so malformed scope
      // output cannot leak resources created during activate().
      extensions.push({ activation, id: extension.manifest.id });
      const activatedScopes = snapshotActivatedScopes(activation, extension.manifest.id, extension.manifest.scopes ?? []);
      for (const [name, scope] of activatedScopes) {
        if (scopes.has(name)) {
          throw new PageHostError('dom.scope.duplicate', `Scope "$${name}" is provided more than once.`);
        }
        scopes.set(name, scope);
      }
    }
    releaseScopes = reserveExtensionScopeProviders(scopes, activeScopeProviders);
    return { extensions, releaseScopes, scopes };
  } catch (error) {
    releaseScopes?.();
    try {
      await disposeExtensions(extensions);
    } catch {
      // The activation error remains the useful diagnostic.
    }
    throw error;
  }
}

/**
 * A trusted runtime is still responsible for creating independent backing
 * state, but one PageHost additionally rejects reuse of the exact provider
 * object while a previous mount is active. This prevents a singleton provider
 * from silently coupling two pages in the common integration mistake.
 */
function reserveExtensionScopeProviders(
  scopes: ReadonlyMap<string, ScopeSnapshot>,
  active: Set<PageScopeProvider>,
): () => void {
  const reserved = new Set<PageScopeProvider>();
  for (const scope of scopes.values()) {
    if (reserved.has(scope.provider) || active.has(scope.provider)) {
      throw new PageHostError(
        'dom.extension.activation.scope.reused',
        `Extension runtime reused active scope "$${scope.manifest.name}" across mounts.`,
      );
    }
    reserved.add(scope.provider);
  }
  for (const provider of reserved) {
    active.add(provider);
  }
  let released = false;
  return () => {
    if (released) return;
    released = true;
    for (const provider of reserved) {
      active.delete(provider);
    }
  };
}

function assertRuntimeCompatible(
  runtime: RegisteredPageExtensionRuntime | undefined,
  id: string,
  version: string,
  contracts: readonly ScopeManifest[],
  origin: PageOrigin,
): asserts runtime is RegisteredPageExtensionRuntime {
  if (!runtime) {
    throw new PageHostError('dom.extension.runtime.missing', `No trusted runtime is registered for extension "${id}".`);
  }
  if (runtime.id !== id || runtime.version !== version) {
    throw new PageHostError(
      'dom.extension.runtime.version.mismatch',
      `Trusted runtime "${id}@${runtime.version}" does not match extension manifest version "${version}".`,
    );
  }
  if (!extensionScopeContractsMatch(runtime.scopes, contracts)) {
    throw new PageHostError(
      'dom.extension.runtime.scope.mismatch',
      `Trusted runtime "${id}" does not declare the extension manifest scope contract.`,
    );
  }
  if (origin === 'remote' && !runtime.allowRemote) {
    throw new PageHostError(
      'dom.extension.runtime.remote.disallowed',
      `Trusted runtime "${id}" is not available to remote pages.`,
    );
  }
}

function snapshotActivatedScopes(
  activation: PageExtensionActivation,
  extensionId: string,
  contracts: readonly ScopeManifest[],
): ReadonlyMap<string, ScopeSnapshot> {
  if (!activation || typeof activation !== 'object' || Array.isArray(activation)) {
    throw new PageHostError('dom.extension.activation.invalid', `Extension runtime "${extensionId}" must return an activation object.`);
  }
  if (Object.keys(activation).some((key) => key !== 'dispose' && key !== 'scopes')) {
    throw new PageHostError('dom.extension.activation.invalid', `Extension runtime "${extensionId}" returned an unknown activation field.`);
  }
  if (activation.dispose !== undefined && typeof activation.dispose !== 'function') {
    throw new PageHostError('dom.extension.activation.dispose.invalid', `Extension runtime "${extensionId}" returned an invalid dispose().`);
  }
  const providers = activation.scopes ?? [];
  if (!Array.isArray(providers)) {
    throw new PageHostError('dom.extension.activation.scopes.invalid', `Extension runtime "${extensionId}" scopes must be an array.`);
  }
  const scopes = new Map<string, ScopeSnapshot>();
  for (const provider of providers) {
    const snapshot = snapshotScope(provider);
    if (provider.extension !== extensionId) {
      throw new PageHostError(
        'dom.extension.activation.scope.owner.invalid',
        `Scope "$${snapshot.manifest.name}" must be owned by extension "${extensionId}".`,
      );
    }
    if (!contracts.some((contract) => scopeContractMatches(contract, snapshot.manifest))) {
      throw new PageHostError(
        'dom.extension.activation.scope.extra',
        `Extension runtime "${extensionId}" returned undeclared scope "$${snapshot.manifest.name}".`,
      );
    }
    if (scopes.has(snapshot.manifest.name)) {
      throw new PageHostError('dom.scope.duplicate', `Scope "$${snapshot.manifest.name}" is provided more than once.`);
    }
    scopes.set(snapshot.manifest.name, snapshot);
  }
  if (!extensionScopeContractsMatch([...scopes.values()].map((scope) => scope.manifest), contracts)) {
    throw new PageHostError(
      'dom.extension.activation.scope.missing',
      `Extension runtime "${extensionId}" did not return every declared extension scope.`,
    );
  }
  return scopes;
}

async function disposeExtensions(extensions: readonly ActiveExtension[]): Promise<void> {
  let error: unknown;
  for (const extension of [...extensions].reverse()) {
    try {
      await extension.activation.dispose?.();
    } catch (cause) {
      error ??= new PageHostError(
        'dom.extension.dispose.failed',
        `Extension runtime "${extension.id}" failed while disposing.`,
        undefined,
        cause,
      );
    }
  }
  if (error) {
    throw error;
  }
}

function isPromiseLike(value: unknown): value is PromiseLike<unknown> {
  return Boolean(value) && (typeof value === 'object' || typeof value === 'function')
    && typeof (value as PromiseLike<unknown>).then === 'function';
}

function cloneScopeManifest(manifest: ScopeManifest): ScopeManifest {
  return cloneDomJson(manifest, `Scope "${manifest.name}" manifest`) as unknown as ScopeManifest;
}

function resolveTarget(target: PageMountTarget, document: globalThis.Document): Element {
  const resolved = typeof target === 'string' ? document.querySelector(target) : target;
  if (!resolved || typeof resolved.replaceChildren !== 'function') {
    throw new PageHostError('dom.target.unavailable', 'Page mount target was not found or does not support replaceChildren().');
  }
  return resolved;
}

function preflightPage(
  page: NormalizedPageSpec,
  registry: PageRegistrySnapshot,
  renderers: DomComponentRendererRegistrySnapshot,
  capabilities: ReadonlyMap<string, PageCapabilityHandler>,
  scopes: ReadonlyMap<string, ScopeSnapshot>,
): void {
  const usedScopes = new Set<string>();
  const invocations: CapabilityInvocation[] = [];
  if (page.lifecycle?.mounted) invocations.push(page.lifecycle.mounted);
  if (page.lifecycle?.unmounted) invocations.push(page.lifecycle.unmounted);

  const visit = (node: UiNode): void => {
    if (!registry.resolveComponent(node.type)) {
      throw new PageHostError('dom.component.unresolved', `Component "${node.type}" is not present in this registry snapshot.`);
    }
    if (!renderers.get(node.type)) {
      throw new PageHostError('dom.renderer.unavailable', `No trusted DOM renderer is registered for component "${node.type}".`);
    }
    for (const value of Object.values(node.props ?? {})) collectScopeReferences(value, usedScopes);
    for (const binding of Object.values(node.bind ?? {})) collectScopeReference(binding, usedScopes);
    for (const invocation of Object.values(node.on ?? {})) {
      invocations.push(invocation);
      if (invocation.args !== undefined) collectScopeReferences(invocation.args, usedScopes, true);
    }
    for (const child of node.children ?? []) visit(child);
    for (const value of Object.values(node.slots ?? {})) {
      for (const child of Array.isArray(value) ? value : [value]) visit(child);
    }
  };
  visit(page.ui);
  for (const invocation of [page.lifecycle?.mounted, page.lifecycle?.unmounted]) {
    if (invocation?.args !== undefined) collectScopeReferences(invocation.args, usedScopes);
  }

  for (const name of usedScopes) {
    if (!scopes.has(name)) {
      throw new PageHostError('dom.scope.provider.missing', `Page binding requires a host provider for scope "$${name}".`);
    }
  }
  for (const invocation of invocations) {
    if (!capabilities.has(invocation.capability)) {
      throw new PageHostError('dom.capability.handler.missing', `No local handler is registered for capability "${invocation.capability}".`);
    }
  }
}

function collectScopeReferences(value: JsonValue, names: Set<string>, allowEvent = false): void {
  if (typeof value === 'string') {
    collectScopeReference(value, names, allowEvent);
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) collectScopeReferences(item, names, allowEvent);
    return;
  }
  if (value !== null && typeof value === 'object') {
    for (const item of Object.values(value)) collectScopeReferences(item, names, allowEvent);
  }
}

function collectScopeReference(value: string, names: Set<string>, allowEvent = false): void {
  const path = parseBindingPath(value);
  if (path && (allowEvent ? path.scope !== 'event' : true)) {
    names.add(path.scope);
  }
}

function readScope(scopes: ReadonlyMap<string, ScopeSnapshot>, path: BindingPath): JsonValue | undefined {
  const scope = scopes.get(path.scope);
  if (!scope) {
    throw new PageHostError('dom.scope.provider.missing', `No host provider is available for scope "$${path.scope}".`);
  }
  const value = scope.provider.read(path.segments);
  return value === undefined ? undefined : cloneDomJson(value, `Scope "$${path.scope}" read value`);
}

async function writeScopeValue(
  scopes: ReadonlyMap<string, ScopeSnapshot>,
  path: BindingPath,
  value: JsonValue,
): Promise<void> {
  const scope = scopes.get(path.scope);
  if (!scope || scope.manifest.mode !== 'readwrite' || typeof scope.provider.write !== 'function') {
    throw new PageHostError('dom.scope.write.unavailable', `Scope "$${path.scope}" is not writable.`);
  }
  await scope.provider.write(path.segments, cloneDomJson(value, `Scope "$${path.scope}" write value`));
}

async function invokeCapability(input: {
  readonly capabilities: ReadonlyMap<string, PageCapabilityHandler>;
  readonly event?: JsonValue;
  readonly invocation: CapabilityInvocation;
  readonly origin: PageOrigin;
  readonly page: NormalizedPageSpec;
  readonly registry: PageRegistrySnapshot;
  readonly resolveScope: (path: BindingPath) => JsonValue | undefined;
}): Promise<void> {
  const registered = input.registry.resolveCapability({ id: input.invocation.capability });
  const handler = input.capabilities.get(input.invocation.capability);
  if (!registered || !handler) {
    throw new PageHostError('dom.capability.unavailable', `Capability "${input.invocation.capability}" is unavailable for this page.`);
  }
  const args = materializeInvocationArgs(input.invocation.args, input.event, input.resolveScope);
  if (registered.manifest.input) {
    if (args === undefined) {
      throw new PageHostError('dom.capability.args.required', `Capability "${input.invocation.capability}" requires arguments.`);
    }
    const issues = validateJsonSchema(args, registered.manifest.input, `capability.${input.invocation.capability}.args`);
    if (issues.length > 0) {
      throw new PageHostError('dom.capability.args.invalid', issues[0]?.message ?? 'Capability arguments are invalid.', issues);
    }
  }
  const context: PageCapabilityContext = Object.freeze({
    ...(input.event === undefined ? {} : { event: cloneDomJson(input.event, 'Capability event payload') }),
    origin: input.origin,
    page: input.page,
  });
  const authorized = await handler.authorize?.(context, args);
  if (authorized === false) {
    throw new PageHostError('dom.capability.authorize.denied', `Capability "${input.invocation.capability}" was denied by its local handler.`);
  }
  const output = await handler.invoke(context, args);
  if (output !== undefined) {
    const normalizedOutput = cloneDomJson(output, `Capability "${input.invocation.capability}" result`);
    const issues = validateJsonSchema(normalizedOutput, registered.manifest.output, `capability.${input.invocation.capability}.result`);
    if (issues.length > 0) {
      throw new PageHostError('dom.capability.result.invalid', issues[0]?.message ?? 'Capability result is invalid.', issues);
    }
  }
}

function materializeInvocationArgs(
  template: JsonValue | undefined,
  event: JsonValue | undefined,
  resolveScope: (path: BindingPath) => JsonValue | undefined,
): JsonValue | undefined {
  if (template === undefined) {
    return undefined;
  }
  try {
    return materializeTemplate(template, (path) => {
      if (path.scope !== 'event') {
        return resolveScope(path);
      }
      if (event === undefined) {
        return undefined;
      }
      return path.segments.length === 0 ? event : readBindingPath(event, path.segments);
    });
  } catch (error) {
    throw new PageHostError('dom.capability.args.materialize.failed', 'Capability arguments could not be materialized at runtime.', undefined, error);
  }
}

function subscribeScopes(
  scopes: ReadonlyMap<string, ScopeSnapshot>,
  listener: () => void,
): () => void {
  const unsubscribes: (() => void)[] = [];
  try {
    for (const scope of scopes.values()) {
      if (scope.provider.subscribe) {
        unsubscribes.push(scope.provider.subscribe(listener));
      }
    }
  } catch (error) {
    for (const unsubscribe of unsubscribes.reverse()) unsubscribe();
    throw new PageHostError('dom.scope.subscribe.failed', 'A host scope could not be subscribed.', undefined, error);
  }
  return () => {
    for (const unsubscribe of unsubscribes.reverse()) {
      try {
        unsubscribe();
      } catch {
        // Unsubscribe cannot compromise page teardown.
      }
    }
  };
}
