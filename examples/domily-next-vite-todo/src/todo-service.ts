import {
  createPageScope,
  type PageCapabilityHandler,
  type TrustedDomComponentRenderer,
} from '@domily/next';
import type { JsonValue } from '@domily/next/pagespec';
import type {
  CapabilityCatalogManifest,
  ComponentCatalogManifest,
} from '@domily/next/registry';

interface Todo extends Record<string, JsonValue> {
  completed: boolean;
  id: string;
  title: string;
}

const initialTodos: readonly Todo[] = [
  { completed: false, id: 'read-proposal', title: '阅读协议草案' },
  { completed: true, id: 'wire-host', title: '接入可信 capability' },
];
let nextTodoId = 1;

export const todoScope = createPageScope({
  name: 'todo',
  initial: { items: copyTodos(initialTodos) },
  value: {
    type: 'object',
    properties: {
      items: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            completed: { type: 'boolean' },
            id: { type: 'string' },
            title: { type: 'string' },
          },
          required: ['completed', 'id', 'title'],
          additionalProperties: false,
        },
      },
    },
    required: ['items'],
    additionalProperties: false,
  },
});

export const todoComponentCatalog: ComponentCatalogManifest = {
  schema: 'domily.component-catalog/v1',
  id: '@example/todo-components',
  version: '1.0.0',
  namespace: 'app',
  components: {
    todoList: {
      description: 'A project-owned interactive todo list renderer.',
      props: {
        type: 'object',
        properties: {
          items: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                completed: { type: 'boolean' },
                id: { type: 'string' },
                title: { type: 'string' },
              },
              required: ['completed', 'id', 'title'],
              additionalProperties: false,
            },
          },
        },
        required: ['items'],
        additionalProperties: false,
      },
      bindings: {
        items: {
          mode: 'read',
          value: { type: 'array' },
        },
      },
      events: {
        toggle: {
          description: 'A todo checkbox changed.',
          payload: {
            type: 'object',
            properties: { completed: { type: 'boolean' }, id: { type: 'string' } },
            required: ['completed', 'id'],
            additionalProperties: false,
          },
        },
      },
    },
  },
};

export const todoCapabilityCatalog: CapabilityCatalogManifest = {
  schema: 'domily.capability-catalog/v1',
  id: '@example/todo-capabilities',
  version: '1.0.0',
  capabilities: [
    {
      id: 'todos.create',
      version: '1.0.0',
      description: 'Creates a todo from the current draft.',
      input: {
        type: 'object',
        properties: { title: { type: 'string' } },
        required: ['title'],
        additionalProperties: false,
      },
      invocation: { localPage: true, remotePage: false },
    },
    {
      id: 'todos.toggle',
      version: '1.0.0',
      description: 'Updates completion state for an existing todo.',
      input: {
        type: 'object',
        properties: { completed: { type: 'boolean' }, id: { type: 'string' } },
        required: ['completed', 'id'],
        additionalProperties: false,
      },
      invocation: { localPage: true, remotePage: false },
    },
  ],
};

/** Normal TypeScript effects registered by the application, never supplied by the PageSpec. */
export const todoCapabilities: Record<string, PageCapabilityHandler> = {
  'todos.create': {
    invoke(_context, args) {
      const title = stringField(args, 'title').trim();
      const current = todoState();
      if (!title) return;
      todoScope.set({
        items: [{ completed: false, id: `todo-${nextTodoId++}`, title }, ...current.items],
      });
    },
  },
  'todos.toggle': {
    invoke(_context, args) {
      const id = stringField(args, 'id');
      const completed = booleanField(args, 'completed');
      const current = todoState();
      todoScope.set({
        ...current,
        items: current.items.map((todo) => todo.id === id ? { ...todo, completed } : todo),
      });
    },
  },
};

/** The project renderer is local code; its manifest stays pure data above. */
export const todoListRenderer: TrustedDomComponentRenderer = {
  type: 'app.todoList',
  mount(context) {
    const list = context.document.createElement('ul');
    const items = Array.isArray(context.props.items) ? context.props.items.filter(isTodo) : [];
    for (const todo of items) {
      const item = context.document.createElement('li');
      const label = context.document.createElement('label');
      const checkbox = context.document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.checked = todo.completed;
      const title = context.document.createElement('span');
      title.textContent = todo.title;
      checkbox.addEventListener('change', () => {
        list.dispatchEvent(new CustomEvent('toggle', { detail: { completed: checkbox.checked, id: todo.id } }));
      });
      label.append(checkbox, title);
      item.append(label);
      list.append(item);
    }
    return {
      nodes: [list],
      eventTarget: list,
      projectEvent(_name, event) {
        const detail = (event as CustomEvent<unknown>).detail;
        return isTodoToggle(detail) ? detail : {};
      },
    };
  },
};

function todoState(): { items: Todo[] } {
  const value = todoScope.read([]);
  if (!value || !isRecord(value) || !Array.isArray(value.items)) {
    throw new Error('The todo scope is invalid.');
  }
  return { items: value.items.filter(isTodo) };
}

function stringField(value: JsonValue | undefined, key: string): string {
  return isRecord(value) && typeof value[key] === 'string' ? value[key] : '';
}

function booleanField(value: JsonValue | undefined, key: string): boolean {
  return isRecord(value) && typeof value[key] === 'boolean' ? value[key] : false;
}

function isTodo(value: JsonValue): value is Todo {
  return isRecord(value)
    && typeof value.id === 'string'
    && typeof value.title === 'string'
    && typeof value.completed === 'boolean';
}

function isTodoToggle(value: unknown): value is { completed: boolean; id: string } {
  return isRecord(value)
    && typeof value.id === 'string'
    && typeof value.completed === 'boolean';
}

function isRecord(value: unknown): value is Record<string, JsonValue> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function copyTodos(items: readonly Todo[]): Todo[] {
  return items.map((todo) => ({ ...todo }));
}
