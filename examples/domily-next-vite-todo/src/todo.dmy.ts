import { action, cap, defineDocument, derived, event, ref, state, view } from '@domily/next/author';

const todoRow = view.checkbox({
  ariaLabel: '切换待办完成状态',
  checked: ref.item('todo', 'completed'),
  label: ref.item('todo', 'title'),
  onChange: action.run('toggleTodo'),
});

export default defineDocument({
  id: 'vite-todo',
  state: state({
    error: null,
    loading: false,
    newTitle: '',
    todos: [],
  }),
  derived: {
    titleIsEmpty: derived.empty(ref.state('newTitle')),
    hasError: derived.not(derived.empty(ref.state('error'))),
  },
  actions: {
    createTodo: action.if(
      ref.derived('titleIsEmpty'),
      [],
      [
        action.set('error', null),
        action.call(cap('todos.create'), {
          args: { title: ref.state('newTitle') },
          assign: 'response',
        }),
        action.set('todos', ref.var('response.items')),
        action.set('newTitle', ''),
      ],
    ),
    loadTodos: action.try(
      [
        action.set('loading', true),
        action.call(cap('todos.list'), { assign: 'response' }),
        action.set('todos', ref.var('response.items')),
        action.set('error', null),
      ],
      {
        catch: [action.set('error', ref.error('message'))],
        finally: [action.set('loading', false)],
      },
    ),
    setNewTitle: action.set('newTitle', event.value()),
    toggleTodo: [
      action.call(cap('todos.toggle'), {
        args: {
          completed: event.checked(),
          id: ref.item('todo', 'id'),
        },
        assign: 'response',
      }),
      action.set('todos', ref.var('response.items')),
    ],
  },
  lifecycle: {
    mounted: action.run('loadTodos'),
  },
  view: view.page({
    title: '待办事项',
    description: '这是由 .dmy.ts 静态编译得到的页面。',
    testId: 'todo-app',
    children: [
      view.form({
        testId: 'todo-form',
        onSubmit: action.run('createTodo'),
        children: [
          view.textField({
            id: 'new-todo-title',
            label: '新待办',
            placeholder: '例如：阅读协议草案',
            value: ref.state('newTitle'),
            onInput: action.run('setNewTitle'),
          }),
          view.button({
            label: '新增待办',
            disabled: ref.derived('titleIsEmpty'),
            type: 'submit',
          }),
        ],
      }),
      view.alert({
        when: ref.derived('hasError'),
        message: ref.state('error'),
      }),
      view.list({
        label: '待办列表',
        testId: 'todo-list',
        each: 'todo',
        in: ref.state('todos'),
        key: ref.item('todo', 'id'),
        template: todoRow,
      }),
    ],
  }),
});
