import { action, cap, defineDocument, derived, event, ref, state, view } from '@domily/next';

const submitLabel = '新增' as const;
const todoTemplate = view.component('p', {}, [view.text({ value: ref.item('todo', 'title') })]);

export default defineDocument({
  id: 'todos',
  state: state({
    newTitle: '',
    todos: [],
    loading: false,
    error: null,
  }),
  derived: {
    canSubmit: derived.not(derived.empty(ref.state('newTitle'))),
  },
  actions: {
    loadTodos: [
      action.set('loading', true),
      action.try(
        [
          action.call(cap('todos.list'), { assign: 'response' }),
          action.set('todos', ref.var('response.items')),
        ],
        {
          catch: [action.set('error', ref.error('message'))],
          finally: [action.set('loading', false)],
        },
      ),
    ],
    createTodo: [
      action.call(cap('todos.create'), { args: { title: ref.state('newTitle') } }),
      action.set('newTitle', ''),
      action.run('loadTodos'),
    ],
  },
  lifecycle: {
    mounted: action.run('loadTodos'),
  },
  view: view.component(
    'div',
    { role: 'main' },
    [
      view.component(
        'input',
        {
          type: 'text',
          value: ref.state('newTitle'),
          placeholder: '待办事项',
        },
        [],
        { input: action.set('newTitle', event.value()) },
      ),
      view.component(
        'button',
        { type: 'button', disabled: ref.derived('canSubmit') },
        [view.text(submitLabel)],
        { click: action.run('createTodo') },
      ),
      view.repeat({
        each: 'todo',
        in: ref.state('todos'),
        key: ref.item('todo', 'id'),
        template: todoTemplate,
      }),
    ],
  ),
});
