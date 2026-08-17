import {
  materializeTemplate,
  parseBindingPath,
  readBindingPath,
  type BindingPath,
} from '../pagespec/binding.ts';
import type {
  CapabilityInvocation,
  JsonValue,
  NormalizedPageSpec,
  UiNode,
} from '../pagespec/types.ts';
import { validateJsonSchema } from '../registry/schema.ts';
import type { PageRegistrySnapshot, ResolvedComponent } from '../registry/types.ts';
import { cloneDomJson } from './value.ts';
import type {
  DomComponentMount,
  DomComponentRendererRegistrySnapshot,
  TrustedDomComponentRenderer,
} from './types.ts';

const blockedPropNames = new Set(['innerhtml', 'outerhtml', 'srcdoc']);

export class PageDomRenderError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly causeValue?: unknown,
  ) {
    super(message);
    this.name = 'PageDomRenderError';
  }
}

export interface PageRenderer {
  dispose(): void;
  render(): void;
}

export interface PageRendererOptions {
  readonly dispatch: (invocation: CapabilityInvocation, event?: JsonValue) => Promise<void>;
  readonly document: globalThis.Document;
  readonly page: NormalizedPageSpec;
  readonly registry: PageRegistrySnapshot;
  readonly renderers: DomComponentRendererRegistrySnapshot;
  readonly reportError: (error: unknown) => void;
  readonly resolveScope: (path: BindingPath) => JsonValue | undefined;
  readonly target: Element;
  readonly writeScope: (path: BindingPath, value: JsonValue) => void | Promise<void>;
}

interface RenderedMount {
  readonly dispose: () => void;
}

interface ListenerTarget {
  addEventListener(name: string, listener: (event: Event) => unknown): void;
  removeEventListener(name: string, listener: (event: Event) => unknown): void;
}

/**
 * The DOM renderer has no knowledge of component tags. It materializes the
 * PageSpec tree and delegates every element to a host-trusted renderer.
 */
export function createPageRenderer(options: PageRendererOptions): PageRenderer {
  return new DomPageRenderer(options);
}

class DomPageRenderer implements PageRenderer {
  private mounts: readonly RenderedMount[] = [];
  private disposed = false;
  private rendering = false;

  constructor(private readonly options: PageRendererOptions) {}

  render(): void {
    if (this.disposed) {
      throw new PageDomRenderError('dom.render.disposed', 'Cannot render an unmounted page.');
    }
    if (this.rendering) {
      throw new PageDomRenderError('dom.render.reentrant', 'A scope update attempted to render the same page recursively.');
    }
    this.rendering = true;
    const nextMounts: RenderedMount[] = [];
    try {
      const focus = captureFocus(this.options.target, this.options.document);
      const nodes = this.renderNode(this.options.page.ui, 'ui', nextMounts);
      this.options.target.replaceChildren(...nodes);
      const previousMounts = this.mounts;
      this.mounts = nextMounts;
      disposeMounts(previousMounts, this.options.reportError);
      restoreFocus(this.options.target, focus);
    } catch (error) {
      disposeMounts(nextMounts, this.options.reportError);
      throw error;
    } finally {
      this.rendering = false;
    }
  }

  dispose(): void {
    if (this.disposed) {
      return;
    }
    this.disposed = true;
    const mounts = this.mounts;
    this.mounts = [];
    disposeMounts(mounts, this.options.reportError);
  }

  private renderNode(node: UiNode, path: string, mounts: RenderedMount[]): Node[] {
    const resolved = this.options.registry.resolveComponent(node.type);
    const renderer = this.options.renderers.get(node.type);
    if (!resolved || !renderer) {
      throw new PageDomRenderError(
        'dom.renderer.unavailable',
        `No trusted DOM renderer is available for component "${node.type}".`,
      );
    }

    const children = (node.children ?? []).flatMap((child, index) => (
      this.renderNode(child, `${path}.children[${index}]`, mounts)
    ));
    const slots = Object.fromEntries(
      Object.entries(node.slots ?? {}).map(([name, value]) => [
        name,
        (Array.isArray(value) ? value : [value]).flatMap((child, index) => (
          this.renderNode(child, `${path}.slots.${name}[${index}]`, mounts)
        )),
      ]),
    ) as Record<string, readonly Node[]>;
    const props = this.materializeProps(node, resolved, path);
    const mount = mountComponent(renderer, {
      children,
      document: this.options.document,
      nodeId: path,
      props,
      slots,
    });
    markNodes(mount.nodes, path);
    const release = this.bindEvents(node, resolved, mount, path);
    mounts.push({
      dispose: () => {
        release();
        mount.dispose?.();
      },
    });
    return [...mount.nodes];
  }

  private materializeProps(
    node: UiNode,
    resolved: ResolvedComponent,
    path: string,
  ): Record<string, JsonValue> {
    const props: Record<string, JsonValue> = {};
    for (const [name, value] of Object.entries(node.props ?? {})) {
      assertSafeProp(name, path);
      props[name] = materialize(value, this.options.resolveScope, `${path}.props.${name}`);
    }
    for (const [name, binding] of Object.entries(node.bind ?? {})) {
      assertSafeProp(name, path);
      const bindingPath = parseBindingPath(binding);
      if (!bindingPath) {
        throw new PageDomRenderError('dom.binding.invalid', `Binding "${binding}" at ${path}.bind.${name} is invalid.`);
      }
      const value = this.options.resolveScope(bindingPath);
      if (value === undefined) {
        throw new PageDomRenderError('dom.scope.value.unavailable', `Binding "${binding}" is unavailable at render time.`);
      }
      props[name] = cloneDomJson(value, `Binding "${binding}"`);
    }
    const issues = validateJsonSchema(props, resolved.component.props, `${path}.props`);
    if (issues.length > 0) {
      throw new PageDomRenderError('dom.props.schema.invalid', issues[0]?.message ?? `Props at ${path} are invalid.`);
    }
    return props;
  }

  private bindEvents(
    node: UiNode,
    resolved: ResolvedComponent,
    mount: DomComponentMount,
    path: string,
  ): () => void {
    const bindingEvents = Object.entries(node.bind ?? {})
      .flatMap(([name, binding]) => {
        const write = resolved.component.bindings?.[name]?.write;
        return write ? [{ binding, name, ...write }] : [];
      });
    const eventNames = new Set([
      ...Object.keys(node.on ?? {}),
      ...bindingEvents.map((entry) => entry.event),
      ...(mount.preventDefaultEvents ?? []),
    ]);
    if (eventNames.size === 0) {
      return () => {};
    }
    const target = mount.eventTarget ?? firstListenerTarget(mount.nodes);
    if (!isListenerTarget(target)) {
      throw new PageDomRenderError('dom.event.target.unavailable', `Component "${node.type}" has events but did not provide an event target.`);
    }

    const listeners: [string, (event: Event) => Promise<void>][] = [];
    try {
      for (const name of eventNames) {
        const listener = async (event: Event): Promise<void> => {
          try {
            await this.handleEvent(name, event, node, resolved, mount, bindingEvents, path);
          } catch (error) {
            this.options.reportError(error);
          }
        };
        target.addEventListener(name, listener);
        listeners.push([name, listener]);
      }
    } catch (error) {
      for (const [name, listener] of listeners) target.removeEventListener(name, listener);
      throw error;
    }
    return () => {
      for (const [name, listener] of listeners) target.removeEventListener(name, listener);
    };
  }

  private async handleEvent(
    name: string,
    event: Event,
    node: UiNode,
    resolved: ResolvedComponent,
    mount: DomComponentMount,
    bindingEvents: readonly { binding: string; event: string; name: string; valuePath: string }[],
    path: string,
  ): Promise<void> {
    if (mount.preventDefaultEvents?.includes(name)) {
      event.preventDefault();
    }
    const payload = cloneDomJson(
      mount.projectEvent?.(name, event) ?? {},
      `Component "${node.type}" ${name} event payload`,
    );
    const eventManifest = resolved.component.events?.[name];
    const payloadIssues = validateJsonSchema(payload, eventManifest?.payload, `${path}.on.${name}`);
    if (payloadIssues.length > 0) {
      throw new PageDomRenderError('dom.event.payload.invalid', payloadIssues[0]?.message ?? `Event "${name}" payload is invalid.`);
    }
    for (const binding of bindingEvents) {
      if (binding.event !== name) {
        continue;
      }
      const bindingPath = parseBindingPath(binding.binding);
      const value = readBindingPath(payload, binding.valuePath.split('.'));
      if (!bindingPath || value === undefined) {
        throw new PageDomRenderError(
          'dom.binding.write.unavailable',
          `Component "${node.type}" event "${name}" cannot write binding "${binding.name}".`,
        );
      }
      await this.options.writeScope(bindingPath, cloneDomJson(value, `Binding "${binding.binding}" event value`));
    }
    const invocation = node.on?.[name];
    if (invocation) {
      await this.options.dispatch(invocation, payload);
    }
  }
}

function mountComponent(
  renderer: TrustedDomComponentRenderer,
  context: Parameters<TrustedDomComponentRenderer['mount']>[0],
): DomComponentMount {
  let mount: DomComponentMount;
  try {
    mount = renderer.mount(context);
  } catch (error) {
    throw new PageDomRenderError('dom.renderer.mount.failed', `Renderer "${renderer.type}" failed to mount.`, error);
  }
  if (!mount || !Array.isArray(mount.nodes) || mount.nodes.some((node) => !node || typeof node !== 'object')) {
    throw new PageDomRenderError('dom.renderer.mount.invalid', `Renderer "${renderer.type}" must return DOM nodes.`);
  }
  return mount;
}

function materialize(
  value: JsonValue,
  resolve: (path: BindingPath) => JsonValue | undefined,
  path: string,
): JsonValue {
  try {
    return materializeTemplate(value, resolve);
  } catch (error) {
    throw new PageDomRenderError('dom.binding.materialize.failed', `Unable to materialize ${path}.`, error);
  }
}

function assertSafeProp(name: string, path: string): void {
  const normalized = name.toLowerCase();
  if (normalized.startsWith('on') || blockedPropNames.has(normalized)) {
    throw new PageDomRenderError('dom.prop.disallowed', `Property "${name}" is not allowed at ${path}.`);
  }
}

function isListenerTarget(value: unknown): value is ListenerTarget {
  return Boolean(value)
    && typeof (value as ListenerTarget).addEventListener === 'function'
    && typeof (value as ListenerTarget).removeEventListener === 'function';
}

function firstListenerTarget(nodes: readonly Node[]): ListenerTarget | undefined {
  return nodes.find(isListenerTarget);
}

function disposeMounts(mounts: readonly RenderedMount[], reportError: (error: unknown) => void): void {
  for (const mount of [...mounts].reverse()) {
    try {
      mount.dispose();
    } catch (error) {
      reportError(error);
    }
  }
}

interface FocusSnapshot {
  readonly nodeId: string;
  readonly selection?: { readonly direction: SelectionDirection | null; readonly end: number | null; readonly start: number | null };
}

function captureFocus(root: Element, document: globalThis.Document): FocusSnapshot | undefined {
  const active = document.activeElement;
  if (!active || !root.contains(active)) {
    return undefined;
  }
  const nodeId = active.getAttribute('data-domily-node');
  if (!nodeId) {
    return undefined;
  }
  const selectable = active as HTMLInputElement;
  return {
    nodeId,
    ...(typeof selectable.selectionStart === 'number'
      ? {
          selection: {
            direction: selectable.selectionDirection,
            end: selectable.selectionEnd,
            start: selectable.selectionStart,
          },
        }
      : {}),
  };
}

function restoreFocus(root: Element, snapshot: FocusSnapshot | undefined): void {
  if (!snapshot) {
    return;
  }
  const candidate = findNodeById(root, snapshot.nodeId);
  if (!candidate || typeof (candidate as HTMLElement).focus !== 'function') {
    return;
  }
  const element = candidate as HTMLInputElement;
  element.focus();
  if (snapshot.selection && typeof element.setSelectionRange === 'function') {
    element.setSelectionRange(snapshot.selection.start, snapshot.selection.end, snapshot.selection.direction ?? undefined);
  }
}

function markNodes(nodes: readonly Node[], path: string): void {
  for (const node of nodes) {
    if (typeof (node as Element).setAttribute === 'function') {
      (node as Element).setAttribute('data-domily-node', path);
    }
  }
}

function findNodeById(root: Element, nodeId: string): Element | undefined {
  const queue: Node[] = [...root.childNodes];
  while (queue.length > 0) {
    const node = queue.shift()!;
    if (typeof (node as Element).getAttribute === 'function' && (node as Element).getAttribute('data-domily-node') === nodeId) {
      return node as Element;
    }
    queue.push(...node.childNodes);
  }
  return undefined;
}
