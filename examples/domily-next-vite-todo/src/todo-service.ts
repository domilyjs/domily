import { defineCapabilities } from '@domily/next';

interface Todo {
  completed: boolean;
  id: string;
  title: string;
}

const todos: Todo[] = [
  { completed: false, id: 'read-proposal', title: '阅读协议草案' },
  { completed: true, id: 'wire-host', title: '接入可信 capability' },
];
let nextTodoId = 1;

/** Business effects stay in capability handlers, never in the page DSL. */
export const todoCapabilities = defineCapabilities({
  'todos.create': ({ title }: { title: string }) => {
    const normalized = title.trim();
    if (!normalized) return { items: copyTodos() };
    todos.unshift({ completed: false, id: `todo-${nextTodoId++}`, title: normalized });
    return { items: copyTodos() };
  },
  'todos.list': () => ({ items: copyTodos() }),
  'todos.toggle': ({ completed, id }: { completed: boolean; id: string }) => {
    const todo = todos.find((candidate) => candidate.id === id);
    if (!todo) return { items: copyTodos() };
    todo.completed = completed;
    return { items: copyTodos() };
  },
});

function copyTodos(): Todo[] {
  return todos.map((todo) => ({ ...todo }));
}
