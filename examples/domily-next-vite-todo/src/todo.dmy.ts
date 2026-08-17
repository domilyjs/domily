import { definePage } from '@domily/next';

/**
 * This is ordinary TypeScript configuration, not a compiler macro language.
 * Business data and effects remain in the trusted Host registrations.
 */
export default definePage({
  schema: 'domily.page/v1',
  id: 'vite-todo',
  requires: {
    catalogs: ['@domily/native-html@^1', '@domily/next/business-form@^1', '@example/todo-components@^1'],
    capabilities: ['todos.create@^1', 'todos.toggle@^1'],
    extensions: ['@domily/next/business-form@^1'],
  },
  extensions: {
    '@domily/next/business-form': {
      drafts: {
        todoCreate: { initial: { title: '' } },
      },
    },
  },
  ui: {
    type: 'html.main',
    props: { className: 'app-shell' },
    children: [
      {
        type: 'html.div',
        props: { className: 'app-shell__header' },
        children: [
          { type: 'html.p', children: [{ type: 'html.text', props: { value: 'DOMILY NEXT' } }] },
          { type: 'html.p', children: [{ type: 'html.text', props: { value: 'PageSpec + 原生 DOM 的最小待办示例。' } }] },
        ],
      },
      {
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
      {
        type: 'app.todoList',
        props: { items: '$todo.items' },
        on: {
          toggle: {
            capability: 'todos.toggle',
            args: { completed: '$event.completed', id: '$event.id' },
          },
        },
      },
    ],
  },
});
