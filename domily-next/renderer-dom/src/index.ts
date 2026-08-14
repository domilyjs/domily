import type { ActionNode, ViewNode } from '@domily/next-ast';
import {
  DocumentRuntime,
  type RuntimeObject,
  type RuntimeValue,
} from '@domily/next-runtime';

export interface DomPropWriter {
  write(element: HTMLElement, value: RuntimeValue): void;
}

export interface DomEventProjector {
  project(event: Event): RuntimeObject;
}

export interface DomComponentDefinition {
  events: ReadonlyMap<string, DomEventProjector>;
  props: ReadonlyMap<string, DomPropWriter>;
  tagName: string;
}

export interface DomComponentRegistry {
  get(name: string): DomComponentDefinition | undefined;
}

export interface DomRendererOptions {
  document?: globalThis.Document;
  onError?: (error: unknown) => void;
}

export interface MvpDomRegistryOptions {
  allowedImageOrigins?: Iterable<string>;
}

interface FocusSnapshot {
  nodeId: string;
  selectionDirection?: 'backward' | 'forward' | 'none';
  selectionEnd?: number;
  selectionStart?: number;
}

const INTERNAL_NODE_ATTRIBUTE = 'data-domily-node';
const RESERVED_SCOPE_NAMES = new Set(['derived', 'event', 'props', 'state', 'vars']);
const UNSAFE_NAMES = new Set(['__proto__', 'constructor', 'prototype']);
const SAFE_BASE_URL = 'https://domily.invalid';

/** A deterministic renderer-side failure for an unsupported or unsafe view projection. */
export class DomRendererError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'DomRendererError';
  }
}

/**
 * Browser DOM adapter for a DocumentRuntime. It deliberately performs full view
 * projection after committed runtime state changes; it is not a virtual DOM.
 */
export class DomRenderer {
  private domDocument: globalThis.Document | undefined;
  private mounted = false;
  private root: HTMLElement | undefined;
  private unsubscribe: (() => void) | undefined;

  constructor(
    readonly runtime: DocumentRuntime,
    private readonly registry: DomComponentRegistry,
    private readonly options: DomRendererOptions = {},
  ) {}

  async mount(root: HTMLElement): Promise<void> {
    if (this.mounted) {
      throw new DomRendererError('renderer.mount.duplicate', 'A DomRenderer instance can only be mounted once at a time.');
    }
    this.root = root;
    this.domDocument = this.options.document ?? root.ownerDocument ?? currentDocument();
    if (!this.domDocument) {
      this.root = undefined;
      throw new DomRendererError('renderer.document.unavailable', 'A browser Document is required to mount a DOM renderer.');
    }

    this.mounted = true;
    this.unsubscribe = this.runtime.subscribe(() => {
      try {
        this.render();
      } catch (error) {
        this.reportError(error);
      }
    });
    try {
      this.render();
      if (this.runtime.document.lifecycle.mounted) {
        await this.runtime.runLifecycle('mounted');
      }
    } catch (error) {
      this.reportError(error);
      this.detach();
      throw error;
    }
  }

  async unmount(): Promise<void> {
    if (!this.mounted) return;
    let lifecycleError: unknown;
    try {
      if (this.runtime.document.lifecycle.unmounted) {
        await this.runtime.runLifecycle('unmounted');
      }
    } catch (error) {
      lifecycleError = error;
      this.reportError(error);
    } finally {
      this.detach();
    }
    if (lifecycleError !== undefined) throw lifecycleError;
  }

  render(): void {
    const root = this.requireRoot();
    const focus = this.captureFocus(root);
    root.replaceChildren(...this.renderView(this.runtime.document.view, {}, 'view'));
    if (focus) this.restoreFocus(root, focus);
  }

  private renderView(view: ViewNode, scope: RuntimeObject, path: string): Node[] {
    switch (view.kind) {
      case 'text':
        return [this.requireDocument().createTextNode(toText(this.runtime.evaluate(view.value, { scope }), path))];
      case 'fragment':
        return view.children.flatMap((child, index) => this.renderView(child, scope, `${path}.children[${index}]`));
      case 'when': {
        const condition = this.runtime.evaluate(view.condition, { scope });
        if (typeof condition !== 'boolean') {
          throw new DomRendererError('renderer.when.condition', `${path}.condition must evaluate to a boolean.`);
        }
        return condition ? this.renderView(view.child, scope, `${path}.child`) : [];
      }
      case 'repeat':
        return this.renderRepeat(view, scope, path);
      case 'element':
        return [this.renderElement(view, scope, path)];
    }
  }

  private renderRepeat(view: Extract<ViewNode, { kind: 'repeat' }>, scope: RuntimeObject, path: string): Node[] {
    assertScopeName(view.each);
    const values = this.runtime.evaluate(view.in, { scope });
    if (!Array.isArray(values)) {
      throw new DomRendererError('renderer.repeat.source', `${path}.in must evaluate to an array.`);
    }
    const keys = new Set<string>();
    return values.flatMap((item, index) => {
      const itemScope: RuntimeObject = { ...scope, [view.each]: item, $index: index };
      const key = view.key ? this.runtime.evaluate(view.key, { scope: itemScope }) : index;
      const identity = repeatIdentity(key, `${path}.key`);
      if (keys.has(identity)) {
        throw new DomRendererError('renderer.repeat.duplicate-key', `${path}.key produced duplicate key "${identity}".`);
      }
      keys.add(identity);
      return this.renderView(view.template, itemScope, `${path}[${identity}]`);
    });
  }

  private renderElement(view: Extract<ViewNode, { kind: 'element' }>, scope: RuntimeObject, path: string): HTMLElement {
    const definition = this.registry.get(view.component);
    if (!definition) {
      throw new DomRendererError('renderer.component.unknown', `Component "${view.component}" is not registered.`);
    }
    const element = this.requireDocument().createElement(definition.tagName);
    element.setAttribute(INTERNAL_NODE_ATTRIBUTE, path);

    for (const [name, value] of Object.entries(view.props)) {
      const writer = definition.props.get(name);
      if (!writer || name.toLowerCase().startsWith('on')) {
        throw new DomRendererError('renderer.prop.disallowed', `Property "${name}" is not allowed on ${view.component}.`);
      }
      writer.write(element, this.runtime.evaluate(value, { scope }));
    }
    for (const [name, actions] of Object.entries(view.events)) {
      const projector = definition.events.get(name);
      if (!projector) {
        throw new DomRendererError('renderer.event.disallowed', `Event "${name}" is not allowed on ${view.component}.`);
      }
      element.addEventListener(name, async (event) => {
        if (name === 'submit') event.preventDefault();
        try {
          await this.runtime.dispatch(actions as ActionNode | readonly ActionNode[], {
            event: projector.project(event),
            scope,
          });
        } catch (error) {
          this.reportError(error);
        }
      });
    }

    for (const [index, child] of view.children.entries()) {
      element.append(...this.renderView(child, scope, `${path}.children[${index}]`));
    }
    return element;
  }

  private captureFocus(root: HTMLElement): FocusSnapshot | undefined {
    const active = this.requireDocument().activeElement;
    if (!active || !root.contains(active)) return undefined;
    const nodeId = active.getAttribute(INTERNAL_NODE_ATTRIBUTE);
    if (!nodeId) return undefined;
    const selectable = active as HTMLInputElement | HTMLTextAreaElement;
    return {
      nodeId,
      ...(typeof selectable.selectionStart === 'number' ? { selectionStart: selectable.selectionStart } : {}),
      ...(typeof selectable.selectionEnd === 'number' ? { selectionEnd: selectable.selectionEnd } : {}),
      ...(selectable.selectionDirection ? { selectionDirection: selectable.selectionDirection } : {}),
    };
  }

  private restoreFocus(root: HTMLElement, focus: FocusSnapshot): void {
    const element = findManagedElement(root, focus.nodeId);
    if (!element) return;
    element.focus();
    const selectable = element as HTMLInputElement | HTMLTextAreaElement;
    if (
      focus.selectionStart !== undefined &&
      focus.selectionEnd !== undefined &&
      typeof selectable.setSelectionRange === 'function'
    ) {
      selectable.setSelectionRange(focus.selectionStart, focus.selectionEnd, focus.selectionDirection);
    }
  }

  private requireRoot(): HTMLElement {
    if (!this.root || !this.mounted) {
      throw new DomRendererError('renderer.mount.required', 'Mount the renderer before rendering.');
    }
    return this.root;
  }

  private requireDocument(): globalThis.Document {
    if (!this.domDocument) {
      throw new DomRendererError('renderer.document.unavailable', 'A browser Document is required to render.');
    }
    return this.domDocument;
  }

  private reportError(error: unknown): void {
    try {
      this.options.onError?.(error);
    } catch {
      // Diagnostics must not turn a renderer error into an unhandled event rejection.
    }
  }

  private detach(): void {
    this.unsubscribe?.();
    this.unsubscribe = undefined;
    this.root?.replaceChildren();
    this.root = undefined;
    this.domDocument = undefined;
    this.mounted = false;
  }
}

/** Creates the browser tag/attribute/event allowlist defined by proposal 0005. */
export function createMvpDomRegistry(options: MvpDomRegistryOptions = {}): DomComponentRegistry {
  const allowedImageOrigins = new Set(
    [...(options.allowedImageOrigins ?? [])].map((origin) => normalizeHttpsOrigin(origin)),
  );
  const registry = new Map<string, DomComponentDefinition>();
  const globalProps = createGlobalProps();
  const interactiveEvents = createEvents(['blur', 'click', 'focus', 'keydown', 'keyup']);
  const simpleEvents = createEvents(['blur', 'click', 'focus']);

  registry.set('a', definition('a', withGlobalProps(globalProps, [
    ['href', linkProp()],
    ['target', targetProp()],
  ]), interactiveEvents));
  registry.set('button', definition('button', withGlobalProps(globalProps, [
    ['disabled', booleanProp('disabled')],
    ['name', stringProp('name', 128)],
    ['type', enumProp('type', ['button', 'reset', 'submit'])],
    ['value', stringProp('value', 4096)],
  ]), interactiveEvents));
  registry.set('form', definition('form', withGlobalProps(globalProps, [
    ['name', stringProp('name', 128)],
    ['novalidate', booleanProp('novalidate')],
  ]), createEvents(['blur', 'focus', 'submit'])));
  registry.set('img', definition('img', withGlobalProps(globalProps, [
    ['alt', stringProp('alt', 1024)],
    ['height', numberProp('height', 0, 4096)],
    ['src', imageProp(allowedImageOrigins)],
    ['width', numberProp('width', 0, 4096)],
  ]), createEvents(['blur', 'focus'])));
  registry.set('input', definition('input', withGlobalProps(globalProps, [
    ['checked', booleanProp('checked')],
    ['disabled', booleanProp('disabled')],
    ['name', stringProp('name', 128)],
    ['placeholder', stringProp('placeholder', 256)],
    ['required', booleanProp('required')],
    ['type', enumProp('type', ['checkbox', 'date', 'email', 'number', 'password', 'radio', 'text'])],
    ['value', stringProp('value', 4096)],
  ]), createEvents(['blur', 'change', 'focus', 'input', 'keydown', 'keyup'])));
  registry.set('label', definition('label', withGlobalProps(globalProps, [['for', stringProp('for', 128)]]), simpleEvents));
  registry.set('option', definition('option', withGlobalProps(globalProps, [
    ['disabled', booleanProp('disabled')],
    ['selected', booleanProp('selected')],
    ['value', stringProp('value', 4096)],
  ]), simpleEvents));
  registry.set('select', definition('select', withGlobalProps(globalProps, [
    ['disabled', booleanProp('disabled')],
    ['name', stringProp('name', 128)],
    ['required', booleanProp('required')],
    ['value', stringProp('value', 4096)],
  ]), createEvents(['blur', 'change', 'focus', 'input'])));
  registry.set('textarea', definition('textarea', withGlobalProps(globalProps, [
    ['disabled', booleanProp('disabled')],
    ['name', stringProp('name', 128)],
    ['placeholder', stringProp('placeholder', 256)],
    ['required', booleanProp('required')],
    ['value', stringProp('value', 4096)],
  ]), createEvents(['blur', 'change', 'focus', 'input', 'keydown', 'keyup'])));

  for (const tag of ['article', 'div', 'main', 'nav', 'p', 'section', 'span']) {
    registry.set(tag, definition(tag, withGlobalProps(globalProps), interactiveEvents));
  }
  for (const tag of ['h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'header', 'footer', 'strong', 'em', 'small', 'code']) {
    registry.set(tag, definition(tag, withGlobalProps(globalProps), interactiveEvents));
  }
  for (const tag of ['li', 'ol', 'ul', 'table', 'thead', 'tbody', 'tr', 'th', 'td']) {
    registry.set(tag, definition(tag, withGlobalProps(globalProps), simpleEvents));
  }
  return registry;
}

function definition(
  tagName: string,
  props: ReadonlyMap<string, DomPropWriter>,
  events: ReadonlyMap<string, DomEventProjector>,
): DomComponentDefinition {
  return { tagName, props, events };
}

function createGlobalProps(): ReadonlyMap<string, DomPropWriter> {
  return new Map([
    ['aria-label', stringProp('aria-label', 256)],
    ['data-testid', patternProp('data-testid', /^[A-Za-z0-9._:-]{1,128}$/)],
    ['hidden', booleanProp('hidden')],
    ['id', patternProp('id', /^[A-Za-z][A-Za-z0-9_:-]{0,127}$/)],
    ['role', enumProp('role', ['alert', 'button', 'cell', 'columnheader', 'heading', 'img', 'link', 'list', 'listitem', 'main', 'navigation', 'row', 'table', 'textbox'])],
    ['title', stringProp('title', 256)],
  ]);
}

function withGlobalProps(
  globalProps: ReadonlyMap<string, DomPropWriter>,
  additions: readonly (readonly [string, DomPropWriter])[] = [],
): ReadonlyMap<string, DomPropWriter> {
  return new Map([...globalProps, ...additions]);
}

function createEvents(names: readonly string[]): ReadonlyMap<string, DomEventProjector> {
  return new Map(names.map((name) => [name, eventProjector(name)]));
}

function eventProjector(name: string): DomEventProjector {
  switch (name) {
    case 'change':
    case 'input':
      return { project: projectInputEvent };
    case 'keydown':
    case 'keyup':
      return { project: projectKeyboardEvent };
    default:
      return { project: () => ({}) };
  }
}

function stringProp(name: string, maxLength: number): DomPropWriter {
  return {
    write(element, value) {
      if (typeof value !== 'string' || value.length > maxLength) {
        throw new DomRendererError('renderer.prop.value', `Property "${name}" must be a string up to ${maxLength} characters.`);
      }
      element.setAttribute(name, value);
    },
  };
}

function patternProp(name: string, pattern: RegExp): DomPropWriter {
  return {
    write(element, value) {
      if (typeof value !== 'string' || !pattern.test(value)) {
        throw new DomRendererError('renderer.prop.value', `Property "${name}" has an invalid value.`);
      }
      element.setAttribute(name, value);
    },
  };
}

function enumProp(name: string, values: readonly string[]): DomPropWriter {
  const allowed = new Set(values);
  return {
    write(element, value) {
      if (typeof value !== 'string' || !allowed.has(value)) {
        throw new DomRendererError('renderer.prop.value', `Property "${name}" has an unsupported value.`);
      }
      element.setAttribute(name, value);
    },
  };
}

function booleanProp(name: string): DomPropWriter {
  return {
    write(element, value) {
      if (typeof value !== 'boolean') {
        throw new DomRendererError('renderer.prop.value', `Property "${name}" must be a boolean.`);
      }
      if (value) element.setAttribute(name, '');
      else element.removeAttribute(name);
    },
  };
}

function numberProp(name: string, minimum: number, maximum: number): DomPropWriter {
  return {
    write(element, value) {
      if (typeof value !== 'number' || !Number.isInteger(value) || value < minimum || value > maximum) {
        throw new DomRendererError('renderer.prop.value', `Property "${name}" must be an integer from ${minimum} to ${maximum}.`);
      }
      element.setAttribute(name, String(value));
    },
  };
}

function linkProp(): DomPropWriter {
  return {
    write(element, value) {
      element.setAttribute('href', validateUrl(value, 'link'));
    },
  };
}

function imageProp(allowedOrigins: ReadonlySet<string>): DomPropWriter {
  return {
    write(element, value) {
      const raw = validateUrl(value, 'image');
      const url = new URL(raw, SAFE_BASE_URL);
      if (url.origin !== SAFE_BASE_URL && !allowedOrigins.has(url.origin)) {
        throw new DomRendererError('renderer.url.image-origin', 'Image source origin is not allowed by the host.');
      }
      element.setAttribute('src', raw);
    },
  };
}

function targetProp(): DomPropWriter {
  return {
    write(element, value) {
      if (value !== '_blank' && value !== '_self') {
        throw new DomRendererError('renderer.prop.value', 'Property "target" must be "_blank" or "_self".');
      }
      element.setAttribute('target', value);
      if (value === '_blank') element.setAttribute('rel', 'noopener noreferrer');
      else element.removeAttribute('rel');
    },
  };
}

function validateUrl(value: RuntimeValue, kind: 'image' | 'link'): string {
  if (typeof value !== 'string' || value.length === 0 || value.length > 2048) {
    throw new DomRendererError('renderer.url.invalid', `${kind} URL must be a non-empty string up to 2048 characters.`);
  }
  let url: URL;
  try {
    url = new URL(value, SAFE_BASE_URL);
  } catch {
    throw new DomRendererError('renderer.url.invalid', `${kind} URL is invalid.`);
  }
  if (url.username || url.password || (url.origin !== SAFE_BASE_URL && url.protocol !== 'https:')) {
    throw new DomRendererError('renderer.url.disallowed', `${kind} URL must be relative or use https.`);
  }
  return value;
}

function normalizeHttpsOrigin(origin: string): string {
  const url = new URL(origin);
  if (url.protocol !== 'https:' || url.pathname !== '/' || url.search || url.hash || url.username || url.password) {
    throw new DomRendererError('renderer.options.image-origin', `Image origin "${origin}" must be an https origin.`);
  }
  return url.origin;
}

function projectInputEvent(event: Event): RuntimeObject {
  const target = event.currentTarget as { checked?: unknown; getAttribute?: (name: string) => string | null; type?: unknown; value?: unknown } | null;
  const type = typeof target?.type === 'string' ? target.type : target?.getAttribute?.('type');
  if ((type === 'checkbox' || type === 'radio') && typeof target?.checked === 'boolean') {
    return { checked: target.checked };
  }
  return { value: typeof target?.value === 'string' ? target.value : '' };
}

function projectKeyboardEvent(event: Event): RuntimeObject {
  const keyboard = event as Event & Partial<KeyboardEvent>;
  return {
    altKey: keyboard.altKey === true,
    code: typeof keyboard.code === 'string' ? keyboard.code : '',
    ctrlKey: keyboard.ctrlKey === true,
    key: typeof keyboard.key === 'string' ? keyboard.key : '',
    metaKey: keyboard.metaKey === true,
    repeat: keyboard.repeat === true,
    shiftKey: keyboard.shiftKey === true,
  };
}

function toText(value: RuntimeValue, path: string): string {
  if (value === null) return '';
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return String(value);
  throw new DomRendererError('renderer.text.non-scalar', `${path} text must evaluate to a scalar value.`);
}

function assertScopeName(name: string): void {
  if (!name || RESERVED_SCOPE_NAMES.has(name) || UNSAFE_NAMES.has(name)) {
    throw new DomRendererError('renderer.repeat.scope-name', `Repeat variable "${name}" is not allowed.`);
  }
}

function repeatIdentity(value: RuntimeValue, path: string): string {
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return `${typeof value}:${String(value)}`;
  }
  throw new DomRendererError('renderer.repeat.key', `${path} must evaluate to a string, number, or boolean.`);
}

function findManagedElement(root: HTMLElement, nodeId: string): HTMLElement | undefined {
  const candidates: Element[] = [root];
  while (candidates.length > 0) {
    const candidate = candidates.pop();
    if (!candidate) continue;
    if (candidate.getAttribute(INTERNAL_NODE_ATTRIBUTE) === nodeId) return candidate as HTMLElement;
    for (const child of Array.from(candidate.children)) candidates.push(child);
  }
  return undefined;
}

function currentDocument(): globalThis.Document | undefined {
  return typeof document === 'undefined' ? undefined : document;
}
