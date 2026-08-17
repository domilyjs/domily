import { describe, expect, test } from 'bun:test';

import { createSourceCodecRegistry } from '@domily/next/codec';
import { normalizePageSpec } from '@domily/next/pagespec';
import { createPageRegistry, type CapabilityCatalogManifest } from '@domily/next/registry';
import { nativeHtmlCatalog } from '@domily/next/native-html';
import {
  createJsonSourceCodecRegistry,
  jsonPageCodec,
  parseJsonPage,
  serializeJsonPage,
} from '../src/index.ts';

const fixture = await Bun.file(new URL('./fixtures/todo.dmy.json', import.meta.url)).text();

describe('JSON PageSpec codec', () => {
  test('implements only the generic source-codec contract', () => {
    const registry = createSourceCodecRegistry([jsonPageCodec]);
    expect(registry.byExtension('.DMY.JSON')).toMatchObject({ id: 'json', version: '1.0.0' });
    expect(createJsonSourceCodecRegistry().byId('json')).toMatchObject({ id: 'json', version: '1.0.0' });
  });

  test('parses generic PageSpec data and allocates JSON pointer node IDs during parse', () => {
    const result = parseJsonPage(fixture);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value.value).toMatchObject({ schema: 'domily.page/v1', id: 'json-todo' });
    expect(result.value.payload).toEqual({ kind: 'text', text: fixture });
    expect(result.value.sourceMap?.nodes['json:/ui/children/0/props/value']).toMatchObject({
      start: expect.objectContaining({ line: expect.any(Number), column: expect.any(Number) }),
    });
  });

  test('leaves PageSpec semantics to the shared core normalizer', () => {
    const parsed = parseJsonPage(fixture);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const registry = createPageRegistry();
    registry.registerComponentCatalog(nativeHtmlCatalog);
    registry.registerCapabilityCatalog(todosCapabilities);

    const normalized = normalizePageSpec(parsed.value.value, { registry });
    expect(normalized.ok).toBe(true);
    if (normalized.ok) {
      expect(normalized.value.ui.children?.[0]?.props?.value).toBe('$$literal-dollar');
    }
  });

  test('round trips generic JSON values without adding AST semantics', () => {
    const parsed = parseJsonPage(fixture);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const serialized = serializeJsonPage(parsed.value.value);
    expect(serialized.ok).toBe(true);
    if (!serialized.ok || serialized.value.kind !== 'text') return;
    const reparsed = parseJsonPage(serialized.value.text);
    expect(reparsed.ok).toBe(true);
    if (reparsed.ok) expect(reparsed.value.value).toEqual(parsed.value.value);
  });

  test('reports source locations for malformed JSON and rejects non-text payloads', () => {
    const invalid = parseJsonPage('{\n  "schema":\n}');
    expect(invalid.ok).toBe(false);
    if (!invalid.ok) expect(invalid.issues[0]).toMatchObject({ code: 'json.syntax', location: { line: expect.any(Number) } });

    const binary = jsonPageCodec.parse({ kind: 'binary', bytes: new Uint8Array([1]) });
    expect(binary).toMatchObject({ ok: false, issues: [expect.objectContaining({ code: 'json.payload.kind.invalid' })] });
  });
});

const todosCapabilities: CapabilityCatalogManifest = {
  schema: 'domily.capability-catalog/v1',
  id: '@test/todos',
  version: '1.0.0',
  capabilities: [{
    id: 'todos.save',
    version: '1.0.0',
    description: 'Saves a todo.',
    invocation: { localPage: true, remotePage: true },
  }],
};
