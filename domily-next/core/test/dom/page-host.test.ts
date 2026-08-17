import { describe, expect, test } from 'bun:test';

import {
  createDomComponentRendererRegistry,
  createPageHost,
  createPageScope,
  type PageScopeProvider,
  type TrustedDomComponentRenderer,
} from '../../src/dom/index.ts';
import { createPageExtensionRuntimeRegistry } from '../../src/extensions/index.ts';
import { nativeHtmlCatalog, registerNativeHtmlRenderers } from '../../src/native-html/index.ts';
import type { JsonValue, PageSpec } from '../../src/pagespec/index.ts';
import {
  createPageRegistry,
  type CapabilityCatalogManifest,
  type ComponentCatalogManifest,
  type ExtensionManifest,
} from '../../src/registry/index.ts';
import { FakeDocument, FakeElement, FakeText, createFakeRoot } from '../support/fake-dom.ts';

const todoCapabilities: CapabilityCatalogManifest = {
  schema: 'domily.capability-catalog/v1',
  id: '@test/todos-capabilities',
  version: '1.0.0',
  capabilities: [
    {
      id: 'todos.save',
      version: '1.0.0',
      description: 'Saves a todo title.',
      input: {
        type: 'object',
        properties: { eventValue: { type: 'string' }, title: { type: 'string' } },
        required: ['eventValue', 'title'],
        additionalProperties: false,
      },
      invocation: { localPage: true, remotePage: true },
    },
  ],
};

const draftSchema = {
  type: 'object' as const,
  properties: { title: { type: 'string' as const } },
  required: ['title'],
  additionalProperties: false,
};

function todoPage(): PageSpec {
  return {
    schema: 'domily.page/v1',
    id: 'todo-form',
    requires: {
      catalogs: ['@domily/native-html@^1'],
      capabilities: ['todos.save@^1'],
    },
    ui: {
      type: 'html.div',
      children: [
        {
          type: 'html.input',
          bind: { value: '$draft.title' },
          on: {
            input: {
              capability: 'todos.save',
              args: { eventValue: '$event.value', title: '$draft.title' },
            },
          },
        },
        { type: 'html.text', props: { value: '$draft.title' } },
      ],
    },
  };
}

function createNativeRegistry(): ReturnType<typeof createPageRegistry> {
  const registry = createPageRegistry();
  registry.registerComponentCatalog(nativeHtmlCatalog);
  registry.registerCapabilityCatalog(todoCapabilities);
  return registry;
}

function createNativeRenderers() {
  const renderers = createDomComponentRendererRegistry();
  registerNativeHtmlRenderers(renderers);
  return renderers;
}

describe('PageHost', () => {
  test('writes a two-way scope binding before materializing the event capability arguments', async () => {
    const { document, root } = createFakeRoot();
    const draft = createPageScope({ name: 'draft', initial: { title: 'before' }, value: draftSchema });
    const calls: JsonValue[] = [];
    const host = createPageHost({
      registry: createNativeRegistry(),
      renderers: createNativeRenderers(),
      scopes: [draft],
      capabilities: {
        'todos.save': {
          invoke(_context, args) {
            calls.push(args ?? null);
          },
        },
      },
      document: document as unknown as Document,
    });

    await host.mount(todoPage(), root as unknown as Element);
    const input = root.findByTag('input');
    if (!input) throw new Error('Missing rendered input.');
    input.value = 'after';
    await input.emit('input');

    expect(draft.read(['title'])).toBe('after');
    expect(root.textContent).toBe('after');
    expect(calls).toEqual([{ eventValue: 'after', title: 'after' }]);
  });

  test('reports authorization denial without invoking the capability or unmounting the page', async () => {
    const { document, root } = createFakeRoot();
    const draft = createPageScope({ name: 'draft', initial: { title: 'before' }, value: draftSchema });
    const errors: string[] = [];
    let invoked = 0;
    const host = createPageHost({
      registry: createNativeRegistry(),
      renderers: createNativeRenderers(),
      scopes: [draft],
      capabilities: {
        'todos.save': {
          authorize() {
            return false;
          },
          invoke() {
            invoked += 1;
          },
        },
      },
      document: document as unknown as Document,
      onError(context) {
        errors.push(context.phase);
      },
    });

    await host.mount(todoPage(), root as unknown as Element);
    const input = root.findByTag('input');
    if (!input) throw new Error('Missing rendered input.');
    input.value = 'still-visible';
    await input.emit('input');

    expect(draft.read(['title'])).toBe('still-visible');
    expect(root.textContent).toBe('still-visible');
    expect(invoked).toBe(0);
    expect(errors).toContain('event');
  });

  test('performs a runtime input-schema check after event materialization', async () => {
    const document = new FakeDocument();
    const root = new FakeElement(document, 'root');
    const registry = createPageRegistry();
    registry.registerComponentCatalog(eventCatalog);
    registry.registerCapabilityCatalog({
      schema: 'domily.capability-catalog/v1',
      id: '@test/event-capabilities',
      version: '1.0.0',
      capabilities: [
        {
          id: 'events.save',
          version: '1.0.0',
          description: 'Accepts a string event value.',
          input: {
            type: 'object',
            properties: { value: { type: 'string' } },
            required: ['value'],
            additionalProperties: false,
          },
          invocation: { localPage: true, remotePage: true },
        },
      ],
    });
    const renderers = createDomComponentRendererRegistry([eventSourceRenderer]);
    const errors: string[] = [];
    let invoked = 0;
    const host = createPageHost({
      registry,
      renderers,
      capabilities: {
        'events.save': {
          invoke() {
            invoked += 1;
          },
        },
      },
      document: document as unknown as Document,
      onError(context) {
        errors.push(context.phase);
      },
    });
    const page: PageSpec = {
      schema: 'domily.page/v1',
      id: 'runtime-schema',
      requires: { catalogs: ['@test/events'], capabilities: ['events.save'] },
      ui: {
        type: 'test.eventSource',
        on: { change: { capability: 'events.save', args: { value: '$event.value' } } },
      },
    };

    await host.mount(page, root as unknown as Element);
    const source = root.findByTag('button');
    if (!source) throw new Error('Missing event source.');
    await source.emit('change', { detail: { value: 7 } });

    expect(invoked).toBe(0);
    expect(errors).toContain('event');
    expect(root.findByTag('button')).toBeDefined();
  });

  test('runs lifecycle hooks and still tears down renderer, subscriptions, and DOM after unmount failure', async () => {
    const document = new FakeDocument();
    const root = new FakeElement(document, 'root');
    const calls: string[] = [];
    const registry = createPageRegistry();
    registry.registerComponentCatalog(disposableCatalog());
    registry.registerCapabilityCatalog(lifecycleCapabilities());
    const scope: PageScopeProvider = {
      manifest: { name: 'lifecycle', mode: 'read' },
      read() {
        return undefined;
      },
      subscribe() {
        return () => calls.push('unsubscribe');
      },
    };
    const host = createPageHost({
      registry,
      renderers: createDomComponentRendererRegistry([{
        type: 'test.disposable',
        mount() {
          return {
            nodes: [document.createElement('div')],
            dispose() {
              calls.push('dispose');
            },
          };
        },
      }]),
      scopes: [scope],
      capabilities: {
        'life.mounted': { invoke() { calls.push('mounted'); } },
        'life.unmounted': { invoke() { calls.push('unmounted'); throw new Error('unmount failed'); } },
      },
      document: document as unknown as Document,
    });
    const page: PageSpec = {
      schema: 'domily.page/v1',
      id: 'lifecycle',
      requires: { catalogs: ['@test/disposable'], capabilities: ['life.mounted', 'life.unmounted'] },
      lifecycle: {
        mounted: { capability: 'life.mounted' },
        unmounted: { capability: 'life.unmounted' },
      },
      ui: { type: 'test.disposable' },
    };

    const mounted = await host.mount(page, root as unknown as Element);
    await expect(mounted.unmount()).rejects.toThrow('unmount failed');

    expect(calls).toEqual(['mounted', 'unmounted', 'dispose', 'unsubscribe']);
    expect(root.textContent).toBe('');
  });

  test('cleans committed DOM and renderer listeners if scope subscription fails during mount', async () => {
    const document = new FakeDocument();
    const root = new FakeElement(document, 'root');
    const calls: string[] = [];
    const registry = createPageRegistry();
    registry.registerComponentCatalog(disposableCatalog());
    const host = createPageHost({
      registry,
      renderers: createDomComponentRendererRegistry([{
        type: 'test.disposable',
        mount() {
          return {
            nodes: [document.createElement('div')],
            dispose() {
              calls.push('dispose');
            },
          };
        },
      }]),
      scopes: [{
        manifest: { name: 'failing', mode: 'read' },
        read() {
          return undefined;
        },
        subscribe() {
          throw new Error('subscribe failed');
        },
      }],
      document: document as unknown as Document,
    });
    const page: PageSpec = {
      schema: 'domily.page/v1',
      id: 'subscription-failure',
      requires: { catalogs: ['@test/disposable'] },
      ui: { type: 'test.disposable' },
    };

    await expect(host.mount(page, root as unknown as Element)).rejects.toThrow('subscribed');
    expect(calls).toEqual(['dispose']);
    expect(root.textContent).toBe('');
  });

  test('preflights missing renderer, capability handler, and scope before changing the target DOM', async () => {
    const document = new FakeDocument();
    const root = new FakeElement(document, 'root');
    root.append(new FakeText('keep') as unknown as Node);
    const registry = createNativeRegistry();
    const draft = createPageScope({ name: 'draft', initial: { title: 'before' }, value: draftSchema });
    const rendererMissing = createPageHost({
      registry,
      renderers: createDomComponentRendererRegistry(),
      scopes: [draft],
      capabilities: { 'todos.save': { invoke() {} } },
      document: document as unknown as Document,
    });
    await expect(rendererMissing.mount(todoPage(), root as unknown as Element)).rejects.toThrow('renderer');
    expect(root.textContent).toBe('keep');

    const handlerMissing = createPageHost({
      registry,
      renderers: createNativeRenderers(),
      scopes: [draft],
      document: document as unknown as Document,
    });
    await expect(handlerMissing.mount(todoPage(), root as unknown as Element)).rejects.toThrow('handler');
    expect(root.textContent).toBe('keep');

    const scopeMissing = createPageHost({
      registry,
      renderers: createNativeRenderers(),
      capabilities: { 'todos.save': { invoke() {} } },
      document: document as unknown as Document,
    });
    await expect(scopeMissing.mount(todoPage(), root as unknown as Element)).rejects.toThrow('validation');
    expect(root.textContent).toBe('keep');
  });

  test('activates a fresh extension-owned scope only for an enabled extension and disposes it on unmount', async () => {
    const { document, root } = createFakeRoot();
    const registry = createNativeRegistry();
    const extension: ExtensionManifest = {
      schema: 'domily.extension/v1',
      id: '@test/draft-scope',
      version: '1.0.0',
      description: 'Owns the draft scope.',
      delivery: { remotePage: true },
      config: { type: 'object', additionalProperties: false },
      scopes: [{ name: 'draft', mode: 'read', value: draftSchema }],
    };
    registry.registerExtension(extension);
    const createdScopes: PageScopeProvider[] = [];
    let activations = 0;
    let disposals = 0;
    const extensionRuntimes = createPageExtensionRuntimeRegistry([{
      id: extension.id,
      version: extension.version,
      allowRemote: true,
      scopes: extension.scopes,
      activate(context) {
        activations += 1;
        expect(Object.isFrozen(context.config)).toBe(true);
        const scope = createPageScope({
          extension: context.id,
          initial: { title: `owned-${activations}` },
          mode: 'read',
          name: 'draft',
          value: draftSchema,
        });
        createdScopes.push(scope);
        return { scopes: [scope], dispose() { disposals += 1; } };
      },
    }]);
    const base = {
      document: document as unknown as Document,
      extensionRuntimes,
      registry,
      renderers: createNativeRenderers(),
    };
    const unactivated: PageSpec = {
      schema: 'domily.page/v1',
      id: 'unactivated-extension-scope',
      requires: { catalogs: ['@domily/native-html'] },
      ui: { type: 'html.text', props: { value: '$draft.title' } },
    };
    await expect(createPageHost(base).mount(
      unactivated,
      root as unknown as Element,
      { origin: 'remote' },
    )).rejects.toThrow('validation');
    expect(activations).toBe(0);

    const active: PageSpec = {
      schema: 'domily.page/v1',
      id: 'active-extension-scope',
      requires: { catalogs: ['@domily/native-html'], extensions: [extension.id] },
      extensions: { [extension.id]: {} },
      ui: { type: 'html.text', props: { value: '$draft.title' } },
    };
    const staticOwnedScope = createPageScope({
      extension: extension.id,
      initial: { title: 'static' },
      mode: 'read',
      name: 'draft',
      value: draftSchema,
    });
    await expect(createPageHost({ ...base, scopes: [staticOwnedScope] }).mount(
      active,
      root as unknown as Element,
      { origin: 'remote' },
    )).rejects.toThrow('must be created by its runtime');

    const shadowingHostScope = createPageScope({
      initial: { title: 'shadow' },
      mode: 'read',
      name: 'draft',
      value: draftSchema,
    });
    await expect(createPageHost({ ...base, scopes: [shadowingHostScope] }).mount(
      active,
      root as unknown as Element,
      { origin: 'remote' },
    )).rejects.toMatchObject({ code: 'dom.page.invalid' });
    expect(activations).toBe(0);

    const host = createPageHost(base);
    const first = await host.mount(
      active,
      root as unknown as Element,
      { origin: 'remote' },
    );
    expect(root.textContent).toBe('owned-1');
    await first.unmount();
    const second = await host.mount(
      active,
      root as unknown as Element,
      { origin: 'remote' },
    );
    expect(root.textContent).toBe('owned-2');
    expect(createdScopes[0]).not.toBe(createdScopes[1]);
    await second.unmount();
    expect(disposals).toBe(2);
  });

  test('rejects a reused extension scope provider while another mount is active', async () => {
    const document = new FakeDocument();
    const firstRoot = new FakeElement(document, 'first-root');
    const secondRoot = new FakeElement(document, 'second-root');
    const registry = createNativeRegistry();
    const extension: ExtensionManifest = {
      schema: 'domily.extension/v1',
      id: '@test/runtime-isolation',
      version: '1.0.0',
      description: 'Owns an isolated scope per active page.',
      delivery: { remotePage: true },
      config: { type: 'object', additionalProperties: false },
      scopes: [{ name: 'isolatedDraft', mode: 'read', value: draftSchema }],
    };
    registry.registerExtension(extension);
    const singletonScope = createPageScope({
      extension: extension.id,
      initial: { title: 'singleton' },
      mode: 'read',
      name: 'isolatedDraft',
      value: draftSchema,
    });
    let activations = 0;
    let disposals = 0;
    const extensionRuntimes = createPageExtensionRuntimeRegistry([{
      id: extension.id,
      version: extension.version,
      allowRemote: true,
      scopes: extension.scopes,
      activate() {
        activations += 1;
        return {
          scopes: [singletonScope],
          dispose() { disposals += 1; },
        };
      },
    }]);
    const page: PageSpec = {
      schema: 'domily.page/v1',
      id: 'runtime-isolation',
      requires: { catalogs: ['@domily/native-html'], extensions: [extension.id] },
      extensions: { [extension.id]: {} },
      ui: { type: 'html.text', props: { value: '$isolatedDraft.title' } },
    };
    const host = createPageHost({
      document: document as unknown as Document,
      extensionRuntimes,
      registry,
      renderers: createNativeRenderers(),
    });

    const firstPromise = host.mount(page, firstRoot as unknown as Element, { origin: 'remote' });
    const secondPromise = host.mount(page, secondRoot as unknown as Element, { origin: 'remote' });
    const first = await firstPromise;
    await expect(secondPromise).rejects.toMatchObject({ code: 'dom.extension.activation.scope.reused' });
    expect(firstRoot.textContent).toBe('singleton');
    expect(secondRoot.textContent).toBe('');
    expect(activations).toBe(2);
    expect(disposals).toBe(1);

    await first.unmount();
    expect(disposals).toBe(2);
    const third = await host.mount(page, secondRoot as unknown as Element, { origin: 'remote' });
    await third.unmount();
    expect(disposals).toBe(3);
  });

  test('rejects an unavailable or remote-disallowed runtime before DOM commit', async () => {
    const { document, root } = createFakeRoot();
    root.append(new FakeText('keep') as unknown as Node);
    const registry = createNativeRegistry();
    const extension: ExtensionManifest = {
      schema: 'domily.extension/v1',
      id: '@test/runtime-permission',
      version: '1.0.0',
      description: 'Tests runtime availability.',
      delivery: { remotePage: true },
      config: { type: 'object', additionalProperties: false },
    };
    registry.registerExtension(extension);
    const page: PageSpec = {
      schema: 'domily.page/v1',
      id: 'runtime-permission',
      requires: { catalogs: ['@domily/native-html'], extensions: [extension.id] },
      extensions: { [extension.id]: {} },
      ui: { type: 'html.div' },
    };
    const base = {
      document: document as unknown as Document,
      registry,
      renderers: createNativeRenderers(),
    };
    await expect(createPageHost(base).mount(page, root as unknown as Element, { origin: 'remote' })).rejects.toThrow('No trusted runtime');
    expect(root.textContent).toBe('keep');

    let activated = 0;
    const extensionRuntimes = createPageExtensionRuntimeRegistry([{
      id: extension.id,
      version: extension.version,
      allowRemote: false,
      activate() {
        activated += 1;
        return {};
      },
    }]);
    await expect(createPageHost({ ...base, extensionRuntimes }).mount(
      page,
      root as unknown as Element,
      { origin: 'remote' },
    )).rejects.toThrow('not available to remote');
    expect(activated).toBe(0);
    expect(root.textContent).toBe('keep');
  });

  test('cleans a malformed activation before it can commit DOM', async () => {
    const { document, root } = createFakeRoot();
    root.append(new FakeText('keep') as unknown as Node);
    const registry = createNativeRegistry();
    const extension: ExtensionManifest = {
      schema: 'domily.extension/v1',
      id: '@test/runtime-cleanup',
      version: '1.0.0',
      description: 'Tests activation cleanup.',
      config: { type: 'object', additionalProperties: false },
      scopes: [{ name: 'runtimeDraft', mode: 'read', value: draftSchema }],
    };
    registry.registerExtension(extension);
    let disposed = 0;
    const extensionRuntimes = createPageExtensionRuntimeRegistry([{
      id: extension.id,
      version: extension.version,
      scopes: extension.scopes,
      activate() {
        return {
          scopes: [createPageScope({
            extension: '@test/wrong-owner',
            initial: { title: 'invalid' },
            mode: 'read',
            name: 'runtimeDraft',
            value: draftSchema,
          })],
          dispose() { disposed += 1; },
        };
      },
    }]);
    const page: PageSpec = {
      schema: 'domily.page/v1',
      id: 'runtime-cleanup',
      requires: { catalogs: ['@domily/native-html'], extensions: [extension.id] },
      extensions: { [extension.id]: {} },
      ui: { type: 'html.text', props: { value: '$runtimeDraft.title' } },
    };
    await expect(createPageHost({
      document: document as unknown as Document,
      extensionRuntimes,
      registry,
      renderers: createNativeRenderers(),
    }).mount(page, root as unknown as Element)).rejects.toThrow('must be owned');
    expect(disposed).toBe(1);
    expect(root.textContent).toBe('keep');
  });
});

const eventCatalog: ComponentCatalogManifest = {
  schema: 'domily.component-catalog/v1',
  id: '@test/events',
  version: '1.0.0',
  namespace: 'test',
  components: {
    eventSource: {
      description: 'A trusted synthetic event source for runtime validation tests.',
      events: {
        change: {
          description: 'A projected value with intentionally broad static type.',
          payload: {
            type: 'object',
            properties: { value: {} },
            required: ['value'],
            additionalProperties: false,
          },
        },
      },
    },
  },
};

const eventSourceRenderer: TrustedDomComponentRenderer = {
  type: 'test.eventSource',
  mount(context) {
    const button = context.document.createElement('button');
    return {
      nodes: [button],
      eventTarget: button,
      projectEvent(_name, event) {
        return (event as unknown as { detail: JsonValue }).detail;
      },
    };
  },
};

function disposableCatalog(): ComponentCatalogManifest {
  return {
    schema: 'domily.component-catalog/v1',
    id: '@test/disposable',
    version: '1.0.0',
    namespace: 'test',
    components: { disposable: { description: 'A disposable trusted test component.' } },
  };
}

function lifecycleCapabilities(): CapabilityCatalogManifest {
  return {
    schema: 'domily.capability-catalog/v1',
    id: '@test/lifecycle-capabilities',
    version: '1.0.0',
    capabilities: [
      {
        id: 'life.mounted',
        version: '1.0.0',
        description: 'Mounted hook.',
        invocation: { localPage: true, remotePage: true },
      },
      {
        id: 'life.unmounted',
        version: '1.0.0',
        description: 'Unmounted hook.',
        invocation: { localPage: true, remotePage: true },
      },
    ],
  };
}
