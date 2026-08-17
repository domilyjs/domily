import { describe, expect, test } from 'bun:test';

import {
  getNativeHtmlRenderer,
  nativeHtmlCatalog,
  writeNativeHtmlProps,
} from '../../src/native-html/index.ts';
import { normalizePageSpec, type PageSpec } from '../../src/pagespec/index.ts';
import { createPageRegistry } from '../../src/registry/index.ts';
import { FakeDocument, FakeElement, FakeText } from '../support/fake-dom.ts';

describe('native-html Catalog and trusted DOM sink', () => {
  test('covers the initial raw HTML surface and forwards className/style without a CSS policy', () => {
    expect(Object.keys(nativeHtmlCatalog.components).sort()).toEqual([
      'a', 'button', 'div', 'form', 'fragment', 'input', 'main', 'p', 'section', 'span', 'text',
    ]);
    const document = new FakeDocument();
    const renderer = getNativeHtmlRenderer('html.div');
    if (!renderer) throw new Error('Missing native div renderer.');
    const mounted = renderer.mount({
      document: document as unknown as Document,
      nodeId: 'native-test.div',
      props: { className: 'layout', style: { backgroundColor: 'black', '--gap': 12 } },
      children: [new FakeText('content') as unknown as Node],
      slots: {},
    });
    const element = mounted.nodes[0] as unknown as FakeElement;

    expect(element.className).toBe('layout');
    expect(element.style.getPropertyValue('background-color')).toBe('black');
    expect(element.style.getPropertyValue('--gap')).toBe('12');
    expect(element.textContent).toBe('content');
  });

  test('protects native sinks even when invoked outside the PageSpec normalizer', () => {
    const document = new FakeDocument();
    const anchor = document.createElement('a') as unknown as FakeElement;

    writeNativeHtmlProps(anchor as unknown as HTMLElement, 'a', { href: 'https://example.com', target: '_blank' });
    expect(anchor.getAttribute('rel')).toBe('noopener noreferrer');
    writeNativeHtmlProps(anchor as unknown as HTMLElement, 'a', { rel: 'opener', target: '_BLANK' });
    expect(anchor.getAttribute('rel')?.split(/\s+/).sort()).toEqual(['noopener', 'noreferrer', 'opener']);
    expect(() => writeNativeHtmlProps(anchor as unknown as HTMLElement, 'a', { innerHTML: '<b>unsafe</b>' })).toThrow('not allowed');
    expect(() => writeNativeHtmlProps(anchor as unknown as HTMLElement, 'a', { onclick: 'alert(1)' })).toThrow('not allowed');
    expect(() => writeNativeHtmlProps(anchor as unknown as HTMLElement, 'a', { href: 'javascript:alert(1)' })).toThrow('relative or HTTPS');
    expect(() => writeNativeHtmlProps(anchor as unknown as HTMLElement, 'a', { href: '//example.com/not-relative' })).toThrow('relative or HTTPS');
    expect(() => writeNativeHtmlProps(anchor as unknown as HTMLElement, 'a', { HREF: 'javascript:alert(1)' })).toThrow('relative or HTTPS');
    expect(() => writeNativeHtmlProps(anchor as unknown as HTMLElement, 'a', { SRC: 'https://example.com/untrusted' })).toThrow('not available');
    expect(() => writeNativeHtmlProps(anchor as unknown as HTMLElement, 'a', { ping: 'https://example.com/track' })).toThrow('not available');
  });

  test('projects form submit as data-only and prevents browser navigation', () => {
    const document = new FakeDocument();
    const renderer = getNativeHtmlRenderer('html.form');
    if (!renderer) throw new Error('Missing native form renderer.');
    const mounted = renderer.mount({
      document: document as unknown as Document,
      nodeId: 'native-test.form',
      props: {},
      children: [],
      slots: {},
    });

    expect(mounted.preventDefaultEvents).toEqual(['submit']);
    expect(mounted.projectEvent?.('submit', {} as Event)).toEqual({});
  });

  test('exposes only catalog-declared native props to remote PageSpec documents', () => {
    const registry = createPageRegistry();
    registry.registerComponentCatalog(nativeHtmlCatalog);
    const page = (props: Record<string, string>): PageSpec => ({
      schema: 'domily.page/v1',
      id: 'remote-anchor',
      requires: { catalogs: ['@domily/native-html'] },
      ui: { type: 'html.a', props },
    });

    expect(normalizePageSpec(page({ className: 'link', href: '/safe' }), { origin: 'remote', registry }).ok).toBe(true);
    expect(normalizePageSpec(page({ HREF: 'javascript:alert(1)' }), { origin: 'remote', registry }).ok).toBe(false);
    expect(normalizePageSpec(page({ ping: 'https://example.com/track' }), { origin: 'remote', registry }).ok).toBe(false);
  });
});
