import { describe, expect, test } from 'bun:test';

import { todoCapabilities, todoScope } from '../src/todo-service.ts';

describe('Domily Next Vite Todo example', () => {
  test('keeps business effects in trusted capability handlers and host-owned scope', async () => {
    await todoCapabilities['todos.create']?.invoke({ origin: 'local', page: {} as never }, { title: '验证示例交互' });
    const created = todoScope.read([]) as { items: { id: string; title: string; completed: boolean }[] };
    const todo = created.items.find((item) => item.title === '验证示例交互');
    expect(todo).toBeDefined();
    if (!todo) return;

    await todoCapabilities['todos.toggle']?.invoke({ origin: 'local', page: {} as never }, { completed: true, id: todo.id });
    const toggled = todoScope.read([]) as { items: { id: string; completed: boolean }[] };
    expect(toggled.items).toContainEqual(expect.objectContaining({ id: todo.id, completed: true }));
  });
});
