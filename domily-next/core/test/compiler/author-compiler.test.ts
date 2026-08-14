import { describe, expect, test } from 'bun:test';

import { compileAuthorModule } from '../../src/compiler/index.ts';

const dslFixture = await Bun.file(new URL('./fixtures/todo.dmy.ts', import.meta.url)).text();

describe('Domily author DSL compiler', () => {
  test('compiles the todo DSL fixture into a frozen AST', () => {
    const compiled = compileAuthorModule(dslFixture);

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
      import { defineDocument as define, state as createState, view as ui } from '@domily/next/author';
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
      import { action, defineDocument, state, view } from '@domily/next/author';
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
      import { action, defineDocument, state, view } from '@domily/next/author';
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
      import { action, defineDocument, state, view } from '@domily/next/author';
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
      import { defineDocument, state, view } from '@domily/next/author';
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

  test('lowers semantic form and list helpers from the public author SDK', () => {
    const result = compileAuthorModule(`
      import { action, cap, defineDocument, derived, event, ref, state, view } from '@domily/next/author';
      export default defineDocument({
        id: 'helpers',
        state: state({ error: null, title: '', todos: [] }),
        derived: { hasError: derived.not(derived.empty(ref.state('error'))) },
        actions: {
          create: action.call(cap('todos.create'), { args: { title: ref.state('title') } }),
          setTitle: action.set('title', event.value()),
          toggle: action.call(cap('todos.toggle'), { args: { id: ref.item('todo', 'id') } }),
        },
        view: view.fragment([
          view.form({
            onSubmit: action.run('create'),
            children: [
              view.textField({ id: 'todo-title', label: 'Todo', value: ref.state('title'), onInput: action.run('setTitle') }),
              view.button({ label: 'Add', type: 'submit' }),
            ],
          }),
          view.alert({ when: ref.derived('hasError'), message: ref.state('error') }),
          view.list({
            label: 'Todos',
            each: 'todo',
            in: ref.state('todos'),
            key: ref.item('todo', 'id'),
            template: view.checkbox({ checked: ref.item('todo', 'completed'), label: ref.item('todo', 'title'), onChange: action.run('toggle') }),
          }),
        ]),
      });
    `);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.meta.capabilities).toEqual(['todos.create', 'todos.toggle']);
    expect(result.value.view).toMatchObject({
      kind: 'fragment',
      children: [
        { kind: 'element', component: 'form', events: { submit: { kind: 'run', action: 'create' } } },
        { kind: 'when', child: { kind: 'element', component: 'p', props: { role: { kind: 'literal', value: 'alert' } } } },
        { kind: 'element', component: 'ul' },
      ],
    });
  });
});
