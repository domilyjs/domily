import { describe, expect, test } from 'bun:test';
import { freezeDocument, type Document } from '../../src/ast/index.ts';
import { DocumentRuntime } from '../../src/runtime/index.ts';
import { createMvpDomRegistry, DomRenderer, DomRendererError } from '../../src/renderer-dom/index.ts';

class FakeNode {
  childNodes: FakeNode[] = [];
  parentNode: FakeNode | undefined;

  append(...nodes: FakeNode[]): void {
    for (const node of nodes) {
      node.parentNode = this;
      this.childNodes.push(node);
    }
  }

  replaceChildren(...nodes: FakeNode[]): void {
    for (const child of this.childNodes) child.parentNode = undefined;
    this.childNodes = [];
    this.append(...nodes);
  }

  contains(node: FakeNode): boolean {
    return node === this || this.childNodes.some((child) => child.contains(node));
  }

  get textContent(): string {
    return this.childNodes.map((child) => child.textContent).join('');
  }
}

class FakeText extends FakeNode {
  constructor(private readonly value: string) {
    super();
  }

  override get textContent(): string {
    return this.value;
  }
}

class FakeEvent {
  defaultPrevented = false;

  constructor(
    readonly currentTarget: FakeElement,
    values: Record<string, unknown>,
  ) {
    Object.assign(this, values);
  }

  preventDefault(): void {
    this.defaultPrevented = true;
  }
}

class FakeElement extends FakeNode {
  readonly attributes = new Map<string, string>();
  readonly children: FakeElement[] = [];
  readonly listeners = new Map<string, ((event: Event) => unknown)[]>();
  checked = false;
  selectionDirection: 'backward' | 'forward' | 'none' = 'none';
  selectionEnd = 0;
  selectionStart = 0;
  type = 'text';
  value = '';

  constructor(
    readonly ownerDocument: FakeDocument,
    readonly tagName: string,
  ) {
    super();
  }

  override append(...nodes: FakeNode[]): void {
    super.append(...nodes);
    for (const node of nodes) {
      if (node instanceof FakeElement) this.children.push(node);
    }
  }

  override replaceChildren(...nodes: FakeNode[]): void {
    super.replaceChildren(...nodes);
    this.children.splice(0, this.children.length);
    for (const node of nodes) {
      if (node instanceof FakeElement) this.children.push(node);
    }
  }

  addEventListener(name: string, listener: (event: Event) => unknown): void {
    const listeners = this.listeners.get(name) ?? [];
    listeners.push(listener);
    this.listeners.set(name, listeners);
  }

  async emit(name: string, values: Record<string, unknown> = {}): Promise<FakeEvent> {
    const event = new FakeEvent(this, values);
    for (const listener of this.listeners.get(name) ?? []) {
      await listener(event as unknown as Event);
    }
    return event;
  }

  focus(): void {
    this.ownerDocument.activeElement = this as unknown as Element;
  }

  getAttribute(name: string): string | null {
    return this.attributes.get(name) ?? null;
  }

  removeAttribute(name: string): void {
    this.attributes.delete(name);
  }

  setAttribute(name: string, value: string): void {
    this.attributes.set(name, value);
    if (name === 'type') this.type = value;
  }

  setSelectionRange(start: number, end: number, direction: 'backward' | 'forward' | 'none' = 'none'): void {
    this.selectionStart = start;
    this.selectionEnd = end;
    this.selectionDirection = direction;
  }
}

class FakeDocument {
  activeElement: Element | null = null;

  createElement(tagName: string): HTMLElement {
    return new FakeElement(this, tagName) as unknown as HTMLElement;
  }

  createTextNode(value: string): Text {
    return new FakeText(value) as unknown as Text;
  }
}

function createDocument(): Document {
  return freezeDocument({
    kind: 'document',
    protocol: 'domily-next',
    version: '0.1',
    meta: { id: 'renderer-test', capabilities: [] },
    state: {
      kind: 'object',
      entries: {
        show: { kind: 'literal', value: true },
        title: { kind: 'literal', value: 'Alpha' },
        mounted: { kind: 'literal', value: false },
        unmounted: { kind: 'literal', value: false },
        todos: {
          kind: 'array',
          items: [
            { kind: 'object', entries: { id: { kind: 'literal', value: 'a' }, label: { kind: 'literal', value: 'First' } } },
            { kind: 'object', entries: { id: { kind: 'literal', value: 'b' }, label: { kind: 'literal', value: 'Second' } } },
          ],
        },
      },
    },
    derived: {},
    actions: {
      setTitle: [{ kind: 'set', path: 'state.title', value: { kind: 'reference', path: 'event.value' } }],
      hide: [{ kind: 'set', path: 'state.show', value: { kind: 'literal', value: false } }],
    },
    lifecycle: {
      mounted: { kind: 'set', path: 'state.mounted', value: { kind: 'literal', value: true } },
      unmounted: { kind: 'set', path: 'state.unmounted', value: { kind: 'literal', value: true } },
    },
    view: {
      kind: 'fragment',
      children: [
        {
          kind: 'element',
          component: 'input',
          props: { type: { kind: 'literal', value: 'text' }, value: { kind: 'reference', path: 'state.title' } },
          events: { input: { kind: 'run', action: 'setTitle' } },
          children: [],
        },
        {
          kind: 'element',
          component: 'button',
          props: { type: { kind: 'literal', value: 'button' } },
          events: { click: { kind: 'run', action: 'hide' } },
          children: [{ kind: 'text', value: { kind: 'literal', value: 'Hide' } }],
        },
        {
          kind: 'element',
          component: 'form',
          props: {},
          events: { submit: { kind: 'run', action: 'hide' } },
          children: [{ kind: 'text', value: { kind: 'literal', value: 'Form' } }],
        },
        {
          kind: 'when',
          condition: { kind: 'reference', path: 'state.show' },
          child: { kind: 'text', value: { kind: 'literal', value: 'Visible' } },
        },
        {
          kind: 'element',
          component: 'ul',
          props: {},
          events: {},
          children: [
            {
              kind: 'repeat',
              each: 'todo',
              in: { kind: 'reference', path: 'state.todos' },
              key: { kind: 'reference', path: 'todo.id' },
              template: {
                kind: 'element',
                component: 'li',
                props: {},
                events: {},
                children: [{ kind: 'text', value: { kind: 'reference', path: 'todo.label' } }],
              },
            },
          ],
        },
        {
          kind: 'element',
          component: 'a',
          props: {
            href: { kind: 'literal', value: 'https://example.test/docs' },
            target: { kind: 'literal', value: '_blank' },
          },
          events: {},
          children: [{ kind: 'text', value: { kind: 'literal', value: 'Docs' } }],
        },
      ],
    },
  });
}

function findFirst(root: FakeElement, tagName: string): FakeElement {
  const queue = [root];
  while (queue.length > 0) {
    const current = queue.shift();
    if (!current) break;
    if (current.tagName === tagName) return current;
    queue.push(...current.children);
  }
  throw new Error(`Could not find ${tagName}.`);
}

describe('DomRenderer', () => {
  test('projects ViewNode, restores controlled input focus, and dispatches sanitized events', async () => {
    const fakeDocument = new FakeDocument();
    const root = new FakeElement(fakeDocument, 'root');
    const runtime = new DocumentRuntime(createDocument());
    const renderer = new DomRenderer(runtime, createMvpDomRegistry(), {
      document: fakeDocument as unknown as globalThis.Document,
    });

    await renderer.mount(root as unknown as HTMLElement);

    expect(root.textContent).toBe('HideFormVisibleFirstSecondDocs');
    expect(runtime.getState()).toMatchObject({ mounted: true });
    expect(findFirst(root, 'a').getAttribute('rel')).toBe('noopener noreferrer');

    const input = findFirst(root, 'input');
    input.focus();
    input.value = 'Beta';
    input.setSelectionRange(2, 2);
    await input.emit('input');

    expect(runtime.getState()).toMatchObject({ title: 'Beta' });
    expect(findFirst(root, 'input').getAttribute('value')).toBe('Beta');
    expect(root.textContent).toContain('FirstSecond');
    expect((fakeDocument.activeElement as unknown as FakeElement).tagName).toBe('input');
    expect((fakeDocument.activeElement as unknown as FakeElement).selectionStart).toBe(2);

    const form = findFirst(root, 'form');
    const submit = await form.emit('submit');
    expect(submit.defaultPrevented).toBe(true);
    expect(root.textContent).not.toContain('Visible');

    await renderer.unmount();
    expect(runtime.getState()).toMatchObject({ unmounted: true });
    expect(root.textContent).toBe('');
    await runtime.runAction('hide');
    expect(root.textContent).toBe('');
  });

  test('rejects a dangerous property even if malformed AST bypasses the validator', async () => {
    const fakeDocument = new FakeDocument();
    const root = new FakeElement(fakeDocument, 'root');
    const malformed = freezeDocument({
      ...createDocument(),
      view: {
        kind: 'element' as const,
        component: 'div',
        props: { innerHTML: { kind: 'literal' as const, value: '<img src=x onerror=alert(1)>' } },
        events: {},
        children: [],
      },
    });
    const renderer = new DomRenderer(new DocumentRuntime(malformed), createMvpDomRegistry(), {
      document: fakeDocument as unknown as globalThis.Document,
    });

    await expect(renderer.mount(root as unknown as HTMLElement)).rejects.toBeInstanceOf(DomRendererError);
    expect(root.textContent).toBe('');
  });

  test('reports a failed event action to the host without leaving an event rejection', async () => {
    const fakeDocument = new FakeDocument();
    const root = new FakeElement(fakeDocument, 'root');
    const errors: unknown[] = [];
    const documentWithFailure = freezeDocument({
      ...createDocument(),
      view: {
        kind: 'element' as const,
        component: 'button',
        props: { type: { kind: 'literal' as const, value: 'button' } },
        events: { click: { kind: 'call' as const, capability: 'missing' } },
        children: [],
      },
    });
    const renderer = new DomRenderer(new DocumentRuntime(documentWithFailure), createMvpDomRegistry(), {
      document: fakeDocument as unknown as globalThis.Document,
      onError(error) {
        errors.push(error);
      },
    });

    await renderer.mount(root as unknown as HTMLElement);
    await findFirst(root, 'button').emit('click');

    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatchObject({ code: 'runtime.capability.undeclared' });
  });
});
