import { describe, expect, test } from 'bun:test';
import {
  createCodecRegistry,
  freezeDocument,
  type Document,
  type DocumentCodec,
} from '@domily/next-ast';
import { MemoryDocumentStore, sha256ContentHash, type DocumentEnvelope } from '@domily/next-loader';
import { createMvpDomRegistry } from '@domily/next-renderer-dom';
import { DomilyDomHost, DomilyDomHostError } from '../src/index.ts';

class FakeNode {
  childNodes: FakeNode[] = [];

  append(...nodes: FakeNode[]): void {
    this.childNodes.push(...nodes);
  }

  contains(node: FakeNode): boolean {
    return node === this || this.childNodes.some((child) => child.contains(node));
  }

  replaceChildren(...nodes: FakeNode[]): void {
    this.childNodes = [];
    this.append(...nodes);
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

class FakeElement extends FakeNode {
  readonly attributes = new Map<string, string>();
  readonly children: FakeElement[] = [];
  readonly listeners = new Map<string, ((event: Event) => unknown)[]>();
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

  async emit(name: string): Promise<void> {
    const event = { currentTarget: this, preventDefault() {} } as unknown as Event;
    for (const listener of this.listeners.get(name) ?? []) {
      await listener(event);
    }
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

function createTodoDocument(heading = 'Todos'): Document {
  return freezeDocument({
    kind: 'document',
    protocol: 'domily-next',
    version: '0.1',
    meta: { id: 'todos', capabilities: ['todos.create'] },
    state: {
      kind: 'object',
      entries: {
        heading: { kind: 'literal', value: heading },
        newTitle: { kind: 'literal', value: '' },
        todos: {
          kind: 'array',
          items: [{ kind: 'object', entries: { id: { kind: 'literal', value: 'first' }, label: { kind: 'literal', value: 'Existing' } } }],
        },
      },
    },
    derived: {},
    actions: {
      setTitle: [{ kind: 'set', path: 'state.newTitle', value: { kind: 'reference', path: 'event.value' } }],
      createTodo: [
        {
          kind: 'call',
          capability: 'todos.create',
          args: { kind: 'object', entries: { title: { kind: 'reference', path: 'state.newTitle' } } },
          assign: 'response',
        },
        { kind: 'set', path: 'state.todos', value: { kind: 'reference', path: 'vars.response.items' } },
        { kind: 'set', path: 'state.newTitle', value: { kind: 'literal', value: '' } },
      ],
    },
    lifecycle: {},
    view: {
      kind: 'fragment',
      children: [
        { kind: 'text', value: { kind: 'reference', path: 'state.heading' } },
        {
          kind: 'element',
          component: 'input',
          props: { type: { kind: 'literal', value: 'text' }, value: { kind: 'reference', path: 'state.newTitle' } },
          events: { input: { kind: 'run', action: 'setTitle' } },
          children: [],
        },
        {
          kind: 'element',
          component: 'button',
          props: { type: { kind: 'literal', value: 'button' } },
          events: { click: { kind: 'run', action: 'createTodo' } },
          children: [{ kind: 'text', value: { kind: 'literal', value: 'Add' } }],
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
      ],
    },
  });
}

function createCodec(): DocumentCodec<string> {
  return {
    extensions: ['test.json'],
    id: 'test-json',
    mediaTypes: ['application/test+json'],
    parse(input) {
      return { issues: [], ok: true, value: freezeDocument(JSON.parse(input) as Document) };
    },
    serialize(document) {
      return { issues: [], ok: true, value: JSON.stringify(document) };
    },
  };
}

async function envelope(document: Document, revision: number): Promise<DocumentEnvelope> {
  const payload = JSON.stringify(document);
  return {
    cache: { maxAgeSeconds: 60 },
    codec: 'test-json',
    contentHash: await sha256ContentHash(payload),
    id: document.meta.id,
    issuedAt: '2026-08-14T00:00:00.000Z',
    payload,
    revision,
  };
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

describe('DomilyDomHost', () => {
  test('loads an envelope, validates it, and renders an interactive form plus list', async () => {
    const document = createTodoDocument();
    const response = await envelope(document, 1);
    const codecs = createCodecRegistry();
    codecs.register(createCodec());
    const fakeDocument = new FakeDocument();
    const root = new FakeElement(fakeDocument, 'root');
    const host = new DomilyDomHost({
      capabilities: {
        'todos.create': {
          execute(args) {
            const candidate = (args as Record<string, unknown>).title;
            const title = typeof candidate === 'string' ? candidate : '';
            return {
              items: [
                { id: 'first', label: 'Existing' },
                { id: 'new', label: title },
              ],
            };
          },
        },
      },
      codecs,
      components: createMvpDomRegistry(),
      document: fakeDocument as unknown as globalThis.Document,
      fetchEnvelope: async () => response,
      store: new MemoryDocumentStore(),
    });

    const mounted = await host.mount('todos', root as unknown as HTMLElement);
    expect(mounted.source).toBe('network');
    expect(root.textContent).toBe('TodosAddExisting');

    const input = findFirst(root, 'input');
    input.value = 'New item';
    await input.emit('input');
    await findFirst(root, 'button').emit('click');

    expect(root.textContent).toBe('TodosAddExistingNew item');
    expect(host.current?.runtime.getState()).toMatchObject({ newTitle: '' });

    const invalidLocalDocument = freezeDocument({
      ...createTodoDocument(),
      view: { kind: 'element' as const, component: 'script', props: {}, events: {}, children: [] },
    });
    await expect(host.mountDocument(invalidLocalDocument, root as unknown as HTMLElement)).rejects.toBeInstanceOf(DomilyDomHostError);
    expect(root.textContent).toBe('TodosAddExistingNew item');

    const invalidEnvelope = await envelope(invalidLocalDocument, 2);
    await expect(host.acceptAndMount(invalidEnvelope, root as unknown as HTMLElement)).rejects.toBeInstanceOf(Error);
    expect(root.textContent).toBe('TodosAddExistingNew item');
  });

  test('applies only a strictly newer revalidated envelope', async () => {
    const initial = createTodoDocument('Cached');
    const updated = createTodoDocument('Updated');
    const initialEnvelope = await envelope(initial, 1);
    const updatedEnvelope = await envelope(updated, 2);
    const codecs = createCodecRegistry();
    codecs.register(createCodec());
    const store = new MemoryDocumentStore();
    await store.put({ document: initial, envelope: initialEnvelope, storedAt: 1_000 });
    const fakeDocument = new FakeDocument();
    const root = new FakeElement(fakeDocument, 'root');
    let resolveFetch: (envelope: DocumentEnvelope) => void = () => {};
    const fetchResult = new Promise<DocumentEnvelope>((resolve) => {
      resolveFetch = resolve;
    });
    let resolveUpdate: () => void = () => {};
    const updateApplied = new Promise<void>((resolve) => {
      resolveUpdate = resolve;
    });
    const host = new DomilyDomHost({
      capabilities: {
        'todos.create': { execute: () => ({ items: [] }) },
      },
      codecs,
      components: createMvpDomRegistry(),
      document: fakeDocument as unknown as globalThis.Document,
      fetchEnvelope: async () => fetchResult,
      now: () => 1_000,
      onDocumentMounted(document) {
        if (document.revision === 2) resolveUpdate();
      },
      store,
    });

    const mounted = await host.mount('todos', root as unknown as HTMLElement);
    expect(mounted.source).toBe('cache');
    expect(root.textContent).toBe('CachedAddExisting');

    resolveFetch(updatedEnvelope);
    await updateApplied;

    expect(host.current?.revision).toBe(2);
    expect(root.textContent).toBe('UpdatedAddExisting');
  });

  test('keeps the active page when a revalidation response is older', async () => {
    const currentDocument = createTodoDocument('Current');
    const olderDocument = createTodoDocument('Older');
    const currentEnvelope = await envelope(currentDocument, 2);
    const olderEnvelope = await envelope(olderDocument, 1);
    const codecs = createCodecRegistry();
    codecs.register(createCodec());
    const store = new MemoryDocumentStore();
    await store.put({ document: currentDocument, envelope: currentEnvelope, storedAt: 1_000 });
    const fakeDocument = new FakeDocument();
    const root = new FakeElement(fakeDocument, 'root');
    let resolveFetch: (envelope: DocumentEnvelope) => void = () => {};
    const fetchResult = new Promise<DocumentEnvelope>((resolve) => {
      resolveFetch = resolve;
    });
    let resolveSkipped: () => void = () => {};
    const skipped = new Promise<void>((resolve) => {
      resolveSkipped = resolve;
    });
    const host = new DomilyDomHost({
      capabilities: { 'todos.create': { execute: () => ({ items: [] }) } },
      codecs,
      components: createMvpDomRegistry(),
      document: fakeDocument as unknown as globalThis.Document,
      fetchEnvelope: async () => fetchResult,
      now: () => 1_000,
      onRevalidationSkipped() {
        resolveSkipped();
      },
      store,
    });

    await host.mount('todos', root as unknown as HTMLElement);
    resolveFetch(olderEnvelope);
    await skipped;

    expect(host.current?.revision).toBe(2);
    expect(root.textContent).toBe('CurrentAddExisting');
  });
});
