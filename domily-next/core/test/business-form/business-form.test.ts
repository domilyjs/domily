import { describe, expect, test } from 'bun:test';

import {
  businessFormExtensionId,
  registerBusinessFormPreset,
} from '../../src/business-form/index.ts';
import {
  createDomComponentRendererRegistry,
  createPageHost,
} from '../../src/dom/index.ts';
import { createPageExtensionRuntimeRegistry } from '../../src/extensions/index.ts';
import { nativeHtmlCatalog, registerNativeHtmlRenderers } from '../../src/native-html/index.ts';
import type { PageSpec } from '../../src/pagespec/index.ts';
import {
  createPageRegistry,
  type CapabilityCatalogManifest,
} from '../../src/registry/index.ts';
import { createFakeRoot } from '../support/fake-dom.ts';

const createCapabilityCatalog: CapabilityCatalogManifest = {
  schema: 'domily.capability-catalog/v1',
  id: '@test/business-form-capabilities',
  version: '1.0.0',
  capabilities: [{
    id: 'todos.create',
    version: '1.0.0',
    description: 'Creates a todo from one explicit title.',
    input: {
      type: 'object',
      properties: { title: { type: 'string' } },
      required: ['title'],
      additionalProperties: false,
    },
    invocation: { localPage: true, remotePage: true },
  }],
};

describe('business-form optional preset', () => {
  test('reduces a string draft form to config while preserving explicit capability submission and focus', async () => {
    const { document, root } = createFakeRoot();
    const registry = createPageRegistry();
    registry.registerComponentCatalog(nativeHtmlCatalog);
    registry.registerCapabilityCatalog(createCapabilityCatalog);
    const renderers = createDomComponentRendererRegistry();
    registerNativeHtmlRenderers(renderers);
    const extensionRuntimes = createPageExtensionRuntimeRegistry();
    registerBusinessFormPreset({ extensionRuntimes, registry, renderers });
    const calls: unknown[] = [];
    const page: PageSpec = {
      schema: 'domily.page/v1',
      id: 'business-form-example',
      requires: {
        catalogs: ['@domily/native-html@^1', `${businessFormExtensionId}@^1`],
        capabilities: ['todos.create@^1'],
        extensions: [`${businessFormExtensionId}@^1`],
      },
      extensions: {
        [businessFormExtensionId]: {
          drafts: { todoCreate: { initial: { title: '' } } },
        },
      },
      ui: {
        type: 'business.form',
        props: {
          className: 'todo-form',
          fields: [{
            className: 'todo-form__input',
            label: '新待办',
            name: 'title',
            placeholder: '例如：阅读协议草案',
            required: true,
          }],
          submitLabel: '新增待办',
        },
        bind: { value: '$businessForm.todoCreate' },
        on: {
          submit: {
            capability: 'todos.create',
            args: { title: '$businessForm.todoCreate.title' },
          },
        },
      },
    };
    const host = createPageHost({
      capabilities: {
        'todos.create': {
          invoke(_context, args) {
            calls.push(args);
          },
        },
      },
      document: document as unknown as Document,
      extensionRuntimes,
      registry,
      renderers,
    });

    const mounted = await host.mount(page, root as unknown as Element, { origin: 'remote' });
    const originalInput = root.findByTag('input');
    if (!originalInput) throw new Error('Missing business form input.');
    expect(root.findByTag('form')?.className).toBe('todo-form');
    expect(originalInput.className).toBe('todo-form__input');
    originalInput.focus();
    originalInput.value = '验证预设';
    await originalInput.emit('input');

    const renderedInput = root.findByTag('input');
    if (!renderedInput) throw new Error('Missing re-rendered business form input.');
    expect(renderedInput).not.toBe(originalInput);
    expect(renderedInput.value).toBe('验证预设');
    expect(document.activeElement).toBe(renderedInput);

    const form = root.findByTag('form');
    if (!form) throw new Error('Missing business form.');
    const event = await form.emit('submit');
    expect(event.defaultPrevented).toBe(true);
    expect(calls).toEqual([{ title: '验证预设' }]);
    await mounted.unmount();
  });
});
