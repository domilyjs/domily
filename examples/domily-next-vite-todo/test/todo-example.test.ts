import { describe, expect, test } from 'bun:test';

import { todoCapabilities } from '../src/todo-service.ts';

interface Todo {
  completed: boolean;
  id: string;
  title: string;
}

interface TodoResult {
  items: Todo[];
}

type BusinessCapability = (args: Record<string, unknown>, context: unknown) => unknown | Promise<unknown>;

function capability(name: keyof typeof todoCapabilities): BusinessCapability {
  const value = todoCapabilities[name];
  if (typeof value !== 'function') {
    throw new Error(`The ${name} capability must be a direct business handler.`);
  }
  return value as BusinessCapability;
}

async function run(name: keyof typeof todoCapabilities, args: Record<string, unknown> = {}): Promise<TodoResult> {
  return (await capability(name)(args, {})) as TodoResult;
}

describe('Domily Next Vite Todo example', () => {
  test('keeps business interaction in direct public capability handlers', async () => {
    const initial = await run('todos.list');
    expect(initial.items).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'read-proposal', title: '阅读协议草案' }),
    ]));

    const created = await run('todos.create', { title: '验证示例交互' });
    const createdTodo = created.items.find((todo) => todo.title === '验证示例交互');
    expect(createdTodo).toBeDefined();
    if (!createdTodo) return;

    const toggled = await run('todos.toggle', { completed: true, id: createdTodo.id });
    expect(toggled.items).toContainEqual(expect.objectContaining({ completed: true, id: createdTodo.id }));
  });
});
