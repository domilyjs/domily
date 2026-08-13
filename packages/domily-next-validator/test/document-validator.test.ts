import { describe, expect, test } from 'bun:test';

import { parseJsonDocument } from '@domily/next-codec-json';

import { createMvpHtmlRegistry, validateDocument } from '../src';

const fixturePath = new URL(
  '../../domily-next-codec-json/test/fixtures/todo.json',
  import.meta.url,
);
const fixture = await Bun.file(fixturePath).text();

function parseFixture() {
  const parsed = parseJsonDocument(fixture);
  if (!parsed.ok) {
    throw new Error(parsed.issues.map((issue) => issue.message).join('\n'));
  }
  return structuredClone(parsed.value);
}

describe('document validator', () => {
  test('accepts the form and list fixture with declared capabilities', () => {
    const result = validateDocument(parseFixture(), {
      components: createMvpHtmlRegistry(),
      capabilities: new Set(['todos.list', 'todos.create']),
    });

    expect(result).toEqual({ ok: true, issues: [] });
  });

  test('rejects inline event-like props even on an allowed element', () => {
    const document = parseFixture();
    const view = document.view;
    if (view.kind !== 'element') {
      throw new Error('Fixture root must be an element.');
    }
    view.props.onclick = { kind: 'literal', value: 'alert(1)' };

    const result = validateDocument(document, {
      components: createMvpHtmlRegistry(),
      capabilities: new Set(['todos.list', 'todos.create']),
    });

    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }
    expect(result.issues).toContainEqual(
      expect.objectContaining({ code: 'view.prop.disallowed', path: 'view.props.onclick' }),
    );
  });

  test('rejects capabilities not declared by the document and host', () => {
    const document = parseFixture();
    const action = document.actions.createTodo?.[0];
    if (!action || action.kind !== 'call') {
      throw new Error('Fixture action must start with a capability call.');
    }
    action.capability = 'orders.delete';

    const result = validateDocument(document, {
      components: createMvpHtmlRegistry(),
      capabilities: new Set(['todos.list', 'todos.create']),
    });

    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }
    expect(result.issues).toContainEqual(
      expect.objectContaining({ code: 'capability.not-declared', path: 'actions.createTodo[0]' }),
    );
    expect(result.issues).toContainEqual(
      expect.objectContaining({ code: 'capability.not-registered', path: 'actions.createTodo[0]' }),
    );
  });

  test('rejects JavaScript URLs in an otherwise allowed anchor', () => {
    const document = parseFixture();
    const view = document.view;
    if (view.kind !== 'element') {
      throw new Error('Fixture root must be an element.');
    }
    view.children.push({
      kind: 'element',
      component: 'a',
      props: { href: { kind: 'literal', value: 'javascript:alert(1)' } },
      events: {},
      children: [],
    });

    const result = validateDocument(document, {
      components: createMvpHtmlRegistry(),
      capabilities: new Set(['todos.list', 'todos.create']),
    });

    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }
    expect(result.issues).toContainEqual(
      expect.objectContaining({ code: 'view.url.disallowed', path: 'view.children[3].props.href' }),
    );
  });
});
