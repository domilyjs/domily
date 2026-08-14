import { describe, expect, test } from 'bun:test';

import { jsonDocumentCodec, parseJsonDocument, parseJsonDocumentWithSourceMap, serializeJsonDocument } from '../src';

const fixturePath = new URL('./fixtures/todo.json', import.meta.url);
const fixture = await Bun.file(fixturePath).text();

describe('JSON document codec', () => {
  test('exposes the format-neutral codec contract', () => {
    expect(jsonDocumentCodec.id).toBe('json');
    expect(jsonDocumentCodec.extensions).toContain('domily.json');
    expect(jsonDocumentCodec.mediaTypes).toContain('application/vnd.domily+json');
  });

  test('normalizes the todo fixture to a frozen AST', () => {
    const result = parseJsonDocument(fixture);

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }

    expect(result.value.kind).toBe('document');
    expect(result.value.meta.id).toBe('todos');
    expect(result.value.derived.canSubmit).toEqual({
      kind: 'expression',
      op: 'not',
      args: [
        {
          kind: 'expression',
          op: 'empty',
          args: [{ kind: 'reference', path: 'state.newTitle' }],
        },
      ],
    });
    expect(Object.isFrozen(result.value)).toBe(true);
    expect(Object.isFrozen(result.value.view)).toBe(true);
  });

  test('round trips a normalized document without changing its AST', () => {
    const initial = parseJsonDocument(fixture);
    expect(initial.ok).toBe(true);
    if (!initial.ok) {
      return;
    }

    const serialized = serializeJsonDocument(initial.value);
    expect(serialized.ok).toBe(true);
    if (!serialized.ok) {
      return;
    }

    const reparsed = parseJsonDocument(serialized.value);
    expect(reparsed).toEqual(initial);
  });

  test('maps parsed AST nodes back to deterministic JSON source node IDs', () => {
    const result = parseJsonDocumentWithSourceMap(fixture);

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }

    const { document, nodeOrigins, sourceMap } = result.value;
    expect(sourceMap.codecId).toBe('json');
    expect(nodeOrigins.get(document)).toEqual(['json:/']);
    expect(nodeOrigins.get(document.view)).toEqual(['json:/view']);

    const value = document.view.kind === 'element' ? document.view.children[0] : undefined;
    expect(value?.kind).toBe('element');
    if (value?.kind !== 'element') {
      return;
    }

    const propertyValue = value.props.value;
    expect(propertyValue).toBeDefined();
    if (!propertyValue) {
      return;
    }

    expect(nodeOrigins.get(propertyValue)).toEqual(['json:/view/children/0/props/value']);
    const range = sourceMap.nodes['json:/view/children/0/props/value'];
    const viewOffset = fixture.indexOf('"view"');
    const expectedOffset = fixture.indexOf('{ "$ref": "state.newTitle" }', viewOffset);
    expect(range?.start.offset).toBe(expectedOffset);
    expect(range?.start.line).toBeGreaterThan(0);
    expect(range?.start.column).toBeGreaterThan(0);
    expect(range?.end.offset).toBe(expectedOffset + '{ "$ref": "state.newTitle" }'.length);
  });

  test('keeps source provenance outside the format-neutral parse result', () => {
    const plain = parseJsonDocument(fixture);
    const sourceMapped = parseJsonDocumentWithSourceMap(fixture);

    expect(plain.ok).toBe(true);
    expect(sourceMapped.ok).toBe(true);
    if (!plain.ok || !sourceMapped.ok) {
      return;
    }

    expect(plain.value).toEqual(sourceMapped.value.document);
    expect('sourceMap' in plain.value).toBe(false);
  });

  test('reports a line and column for invalid JSON', () => {
    const result = parseJsonDocument('{\n  "meta":\n}');

    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }

    expect(result.issues[0]?.code).toBe('json.syntax');
    expect(result.issues[0]?.location?.line).toBeGreaterThan(0);
    expect(result.issues[0]?.location?.column).toBeGreaterThan(0);
  });

  test('reports a line and column when JSON cannot map to the document AST', () => {
    const result = parseJsonDocument(`{
  "meta": {
    "protocol": "domily-next",
    "version": "0.1",
    "id": 123
  },
  "view": { "component": "div" }
}`);

    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }

    expect(result.issues[0]?.code).toBe('json.mapping');
    expect(result.issues[0]?.location).toEqual({ line: 5, column: 5, offset: 71 });
  });
});
