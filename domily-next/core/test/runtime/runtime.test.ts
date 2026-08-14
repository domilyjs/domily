import { describe, expect, test } from 'bun:test';
import { freezeDocument, type Document } from '../../src/ast/index.ts';
import { DocumentRuntime, RuntimeExecutionError, type RuntimeCapability } from '../../src/runtime/index.ts';

function createDocument(): Document {
  return freezeDocument({
    kind: 'document',
    protocol: 'domily-next',
    version: '0.1',
    meta: { id: 'runtime-test', capabilities: ['todos.create'] },
    state: {
      kind: 'object',
      entries: {
        count: { kind: 'literal', value: 1 },
        error: { kind: 'literal', value: null },
        loading: { kind: 'literal', value: false },
        profile: {
          kind: 'object',
          entries: {
            active: { kind: 'literal', value: false },
            name: { kind: 'literal', value: 'Before' },
          },
        },
        result: { kind: 'literal', value: null },
        title: { kind: 'literal', value: 'Write tests' },
      },
    },
    derived: {
      greeting: {
        kind: 'expression',
        op: 'concat',
        args: [{ kind: 'literal', value: 'Hello ' }, { kind: 'reference', path: 'state.title' }],
      },
    },
    actions: {
      increment: [
        {
          kind: 'set',
          path: 'state.count',
          value: {
            kind: 'expression',
            op: 'add',
            args: [{ kind: 'reference', path: 'state.count' }, { kind: 'literal', value: 1 }],
          },
        },
      ],
      updateProfile: [{ kind: 'set', path: 'state.count', value: { kind: 'literal', value: 3 } }],
      branchAndRun: [
        {
          kind: 'merge',
          path: 'state.profile',
          value: { kind: 'object', entries: { name: { kind: 'literal', value: 'After' } } },
        },
        { kind: 'toggle', path: 'state.profile.active' },
        {
          kind: 'if',
          condition: {
            kind: 'expression',
            op: 'eq',
            args: [{ kind: 'reference', path: 'state.title' }, { kind: 'literal', value: 'Write tests' }],
          },
          then: [{ kind: 'run', action: 'updateProfile' }],
        },
      ],
      submit: [
        { kind: 'set', path: 'state.loading', value: { kind: 'literal', value: true } },
        {
          kind: 'try',
          body: [
            {
              kind: 'call',
              capability: 'todos.create',
              args: {
                kind: 'object',
                entries: {
                  secret: { kind: 'literal', value: 'do-not-trace' },
                  title: { kind: 'reference', path: 'state.title' },
                },
              },
              assign: 'response',
            },
            { kind: 'set', path: 'state.result', value: { kind: 'reference', path: 'vars.response.id' } },
          ],
          catch: [{ kind: 'set', path: 'state.error', value: { kind: 'reference', path: 'vars.error.code' } }],
          finally: [{ kind: 'set', path: 'state.loading', value: { kind: 'literal', value: false } }],
        },
      ],
      mutationThenFailure: [
        { kind: 'set', path: 'state.count', value: { kind: 'literal', value: 99 } },
        { kind: 'call', capability: 'missing', assign: 'response' },
      ],
      recurse: [{ kind: 'run', action: 'recurse' }],
    },
    lifecycle: {},
    view: { kind: 'fragment', children: [] },
  });
}

describe('DocumentRuntime', () => {
  test('evaluates expressions and commits a successful named action once', async () => {
    const runtime = new DocumentRuntime(createDocument());

    expect(runtime.evaluate({ kind: 'reference', path: 'derived.greeting' })).toBe('Hello Write tests');
    await runtime.runAction('increment');

    expect(runtime.getState()).toMatchObject({ count: 2 });
  });

  test('turns a capability failure into catch state and always executes finally', async () => {
    const failingCapability: RuntimeCapability = {
      async execute() {
        throw new Error('upstream secret');
      },
    };
    const runtime = new DocumentRuntime(createDocument(), { capabilities: { 'todos.create': failingCapability } });

    await runtime.runAction('submit');

    expect(runtime.getState()).toMatchObject({
      error: 'runtime.capability.failed',
      loading: false,
      result: null,
    });
  });

  test('executes merge, toggle, if, and run in one transaction', async () => {
    const runtime = new DocumentRuntime(createDocument());

    await runtime.runAction('branchAndRun');

    expect(runtime.getState()).toMatchObject({
      count: 3,
      profile: { active: true, name: 'After' },
    });
  });

  test('does not execute a capability that the host denies', async () => {
    let executed = false;
    const runtime = new DocumentRuntime(createDocument(), {
      capabilities: {
        'todos.create': {
          authorize: () => false,
          execute: () => {
            executed = true;
            return { id: 'unreachable' };
          },
        },
      },
    });

    await runtime.runAction('submit');

    expect(executed).toBe(false);
    expect(runtime.getState()).toMatchObject({ error: 'runtime.capability.denied', loading: false });
  });

  test('rejects unsafe state paths before they can alter the transaction draft', async () => {
    const runtime = new DocumentRuntime(createDocument());

    await expect(
      runtime.dispatch({
        kind: 'set',
        path: 'state.__proto__.polluted',
        value: { kind: 'literal', value: true },
      }),
    ).rejects.toMatchObject({ code: 'runtime.path.unsafe' });

    expect(runtime.getState()).not.toHaveProperty('polluted');
  });

  test('rolls back an unhandled failure and does not retain capability payloads in its trace', async () => {
    const traces: unknown[] = [];
    const successfulCapability: RuntimeCapability = {
      execute() {
        return { id: 'todo-1', nested: { secret: 'also-not-traced' } };
      },
    };
    const runtime = new DocumentRuntime(createDocument(), {
      capabilities: { 'todos.create': successfulCapability },
      onTrace(trace) {
        traces.push(trace);
      },
    });

    await runtime.runAction('submit');
    await expect(runtime.runAction('mutationThenFailure')).rejects.toMatchObject({
      code: 'runtime.capability.undeclared',
    });

    expect(runtime.getState()).toMatchObject({ count: 1, result: 'todo-1' });
    expect(JSON.stringify(traces)).not.toContain('do-not-trace');
    expect(JSON.stringify(traces)).not.toContain('also-not-traced');
  });

  test('rejects action recursion and derived cycles without committing state', async () => {
    const cyclicDocument = createDocument();
    const documentWithCycle = freezeDocument({
      ...cyclicDocument,
      derived: {
        first: { kind: 'reference' as const, path: 'derived.second' },
        second: { kind: 'reference' as const, path: 'derived.first' },
      },
    });
    const runtime = new DocumentRuntime(documentWithCycle, { limits: { maxActionDepth: 2 } });

    expect(() => runtime.evaluate({ kind: 'reference', path: 'derived.first' })).toThrow(
      new RuntimeExecutionError('runtime.derived.cycle', 'Derived value "first" forms a cycle.'),
    );
    await expect(runtime.runAction('recurse')).rejects.toMatchObject({ code: 'runtime.action.depth-exceeded' });
    expect(runtime.getState()).toMatchObject({ count: 1 });
  });
});
