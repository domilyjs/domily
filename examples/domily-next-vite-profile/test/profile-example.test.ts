import { describe, expect, test } from 'bun:test';

import {
  createDomComponentRendererRegistry,
  createPageExtensionRuntimeRegistry,
  createPageHost,
  createPageRegistry,
} from '@domily/next';
import { registerBusinessFormPreset } from '@domily/next/business-form';
import { nativeHtmlCatalog, registerNativeHtmlRenderers } from '@domily/next/native-html';
import { FakeElement, createFakeRoot } from '../../../domily-next/core/test/support/fake-dom.ts';
import profilePage from '../src/profile.dmy.ts';
import {
  profileCapabilities,
  profileCapabilityCatalog,
  profileScope,
} from '../src/profile-service.ts';

describe('Domily Next Vite Profile example', () => {
  test('keeps profile persistence inside a trusted capability handler', async () => {
    const capability = profileCapabilities['profile.save'];
    if (!capability) throw new Error('Missing profile.save capability.');

    await capability.invoke(
      { origin: 'local', page: {} as never },
      { displayName: 'Grace Hopper', email: 'grace@example.com' },
    );

    expect(profileScope.read(['lastSaved'])).toBe('已保存 Grace Hopper 的资料（grace@example.com）。');
  });

  test('mounts the multi-field PageSpec through the same business-form preset as Todo', async () => {
    profileScope.set({ lastSaved: '尚未保存资料。' });
    const { document, root } = createFakeRoot();
    const registry = createPageRegistry();
    registry.registerComponentCatalog(nativeHtmlCatalog);
    registry.registerCapabilityCatalog(profileCapabilityCatalog);
    const renderers = createDomComponentRendererRegistry();
    registerNativeHtmlRenderers(renderers);
    const extensionRuntimes = createPageExtensionRuntimeRegistry();
    registerBusinessFormPreset({ extensionRuntimes, registry, renderers });
    const host = createPageHost({
      capabilities: profileCapabilities,
      document: document as unknown as Document,
      extensionRuntimes,
      registry,
      renderers,
      scopes: [profileScope],
    });

    const mounted = await host.mount(profilePage, root as unknown as Element);
    let inputs = findAllByTag(root, 'input');
    expect(inputs).toHaveLength(2);
    inputs[0]!.value = 'Grace Hopper';
    await inputs[0]!.emit('input');
    inputs = findAllByTag(root, 'input');
    inputs[1]!.value = 'grace@example.com';
    await inputs[1]!.emit('input');

    const form = root.findByTag('form');
    if (!form) throw new Error('Missing profile form.');
    const event = await form.emit('submit');
    expect(event.defaultPrevented).toBe(true);
    expect(root.textContent).toContain('已保存 Grace Hopper 的资料（grace@example.com）。');
    await mounted.unmount();
  });
});

function findAllByTag(root: FakeElement, tagName: string): FakeElement[] {
  const matches: FakeElement[] = [];
  const visit = (node: FakeElement): void => {
    if (node.tagName === tagName) matches.push(node);
    for (const child of node.childNodes) {
      if (child instanceof FakeElement) visit(child);
    }
  };
  visit(root);
  return matches;
}
