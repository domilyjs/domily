import { describe, expect, test } from 'bun:test';
import type { Document } from '../src/ast/index.ts';
import { createDomilyApp, defineCapabilities } from '../src/index.ts';

class FakeText {
  constructor(readonly textContent: string) {}
}

class FakeRoot {
  childNodes: FakeText[] = [];

  constructor(readonly ownerDocument: FakeDocument) {}

  replaceChildren(...nodes: FakeText[]): void {
    this.childNodes = nodes;
  }

  get textContent(): string {
    return this.childNodes.map((node) => node.textContent).join('');
  }
}

class FakeDocument {
  activeElement: Element | null = null;

  createTextNode(value: string): Text {
    return new FakeText(value) as unknown as Text;
  }
}

const document: Document = {
  kind: 'document',
  protocol: 'domily-next',
  version: '0.1',
  meta: { id: 'public-sdk', capabilities: ['message.load'] },
  state: {
    kind: 'object',
    entries: { message: { kind: 'literal', value: 'pending' } },
  },
  derived: {},
  actions: {},
  lifecycle: {
    mounted: [
      { kind: 'call', capability: 'message.load', assign: 'response' },
      { kind: 'set', path: 'state.message', value: { kind: 'reference', path: 'vars.response.message' } },
    ],
  },
  view: { kind: 'text', value: { kind: 'reference', path: 'state.message' } },
};

describe('@domily/next public app facade', () => {
  test('mounts with default host infrastructure and concise capability handlers', async () => {
    const fakeDocument = new FakeDocument();
    const root = new FakeRoot(fakeDocument);
    const app = createDomilyApp({
      capabilities: defineCapabilities({
        'message.load': () => ({ message: 'loaded' }),
      }),
      document: fakeDocument as unknown as globalThis.Document,
    });

    await app.mount(document, root as unknown as HTMLElement);

    expect(app.current?.runtime.getState()).toMatchObject({ message: 'loaded' });
    expect(root.textContent).toBe('loaded');
  });
});
