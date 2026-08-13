import { describe, expect, test } from 'bun:test';

import { parseJsonDocument } from '@domily/next-codec-json';

import { compileAuthorModule } from '../src';

const dslFixture = await Bun.file(new URL('./fixtures/todo.domily.ts', import.meta.url)).text();
const jsonFixture = await Bun.file(new URL('../../codec-json/test/fixtures/todo.json', import.meta.url)).text();

describe('Domily author DSL compiler', () => {
  test('normalizes the todo DSL fixture to the same frozen AST as JSON', () => {
    const compiled = compileAuthorModule(dslFixture);
    const parsed = parseJsonDocument(jsonFixture);

    expect(compiled).toEqual(parsed);
    expect(compiled.ok).toBe(true);
    if (!compiled.ok) {
      return;
    }

    expect(Object.isFrozen(compiled.value)).toBe(true);
    expect(Object.isFrozen(compiled.value.view)).toBe(true);
    expect(compiled.value.meta.capabilities).toEqual(['todos.list', 'todos.create']);
  });

  test('supports aliases for named DSL imports', () => {
    const result = compileAuthorModule(`
      import { defineDocument as define, state as createState, view as ui } from '@domily/next';
      export default define({
        id: 'aliased',
        state: createState({}),
        view: ui.text('ok'),
      });
    `);

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.value.meta.id).toBe('aliased');
    expect(result.value.view).toEqual({ kind: 'text', value: { kind: 'literal', value: 'ok' } });
  });

  test('rejects closures and reports their source location', () => {
    const result = compileAuthorModule(`
      import { action, defineDocument, state, view } from '@domily/next';
      export default defineDocument({
        id: 'invalid',
        state: state({ total: 0 }),
        actions: { update: action.set('total', () => 1) },
        view: view.text('invalid'),
      });
    `);

    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }
    expect(result.issues[0]?.code).toBe('dsl.value');
    expect(result.issues[0]?.location?.line).toBeGreaterThan(0);
    expect(result.issues[0]?.location?.column).toBeGreaterThan(0);
  });

  test('keeps diagnostic columns correct after UTF-8 text', () => {
    const result = compileAuthorModule(`
      import { action, defineDocument, state, view } from '@domily/next';
      const label = '待办事项';
      export default defineDocument({
        id: 'invalid',
        state: state({ total: 0 }),
        actions: { update: action.set('total', () => 1) },
        view: view.text(label),
      });
    `);

    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }
    expect(result.issues[0]?.location).toMatchObject({ line: 7, column: 48 });
  });

  test('rejects unknown function calls instead of executing author code', () => {
    const result = compileAuthorModule(`
      import { action, defineDocument, state, view } from '@domily/next';
      export default defineDocument({
        id: 'invalid',
        state: state({ total: 0 }),
        actions: { update: action.set('total', Date.now()) },
        view: view.text('invalid'),
      });
    `);

    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }
    expect(result.issues[0]?.code).toBe('dsl.call');
  });

  test('rejects static constants that refer to a later declaration', () => {
    const result = compileAuthorModule(`
      import { defineDocument, state, view } from '@domily/next';
      const first = second;
      const second = view.text('late');
      export default defineDocument({ id: 'invalid', state: state({}), view: first });
    `);

    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }
    expect(result.issues[0]?.code).toBe('dsl.static.order');
  });
});
