import { describe, expect, test } from 'bun:test';
import { compileAuthorModule } from '@domily/next/compiler';
import { createServer, resolveConfig } from 'vite';
import {
  DomilyViteCompileError,
  domilyNext,
  transformDomilyAuthorModule,
} from '../src/index.ts';

const fixture = await Bun.file(new URL('../../core/test/compiler/fixtures/todo.dmy.ts', import.meta.url)).text();

function documentFromGeneratedModule(code: string): unknown {
  const prefix = 'const document = ';
  const start = code.indexOf(prefix);
  const end = code.indexOf(';\nexport { document };');
  if (start === -1 || end === -1) throw new Error('Generated module does not contain a document declaration.');
  return JSON.parse(code.slice(start + prefix.length, end));
}

describe('Domily Next Vite plugin', () => {
  test('turns a .dmy.ts module into an import-free AST ES module', () => {
    const plugin = domilyNext();
    const transformed = plugin.transform(fixture, '/src/todos.dmy.ts?domily=ast');
    const compiled = compileAuthorModule(fixture);

    expect(transformed).not.toBeNull();
    expect(transformed?.code).not.toContain("from '@domily/next'");
    expect(transformed?.code).toContain('export default document;');
    expect(compiled.ok).toBe(true);
    if (!transformed || !compiled.ok) return;
    expect(documentFromGeneratedModule(transformed.code)).toEqual(compiled.value);
  });

  test('does not process old or ordinary TypeScript modules and supports explicit extensions', () => {
    expect(domilyNext().transform('export const value = 1;', '/src/app.ts')).toBeNull();
    expect(domilyNext().transform(fixture, '/src/todos.domily.ts')).toBeNull();
    expect(domilyNext().transform(fixture, '/src/todos.dmy.ts')).not.toBeNull();

    const plugin = domilyNext({ extensions: ['.ui.ts'] });
    expect(plugin.transform(fixture, '/src/todos.dmy.ts')).toBeNull();
    expect(plugin.transform(fixture, '/src/todos.ui.ts')).not.toBeNull();
  });

  test('keeps the compile-time-only DSL namespace out of Vite dependency optimization', async () => {
    const resolved = await resolveConfig({
      optimizeDeps: { exclude: ['business-api-client'] },
      plugins: [domilyNext()],
    }, 'serve');

    expect(resolved.optimizeDeps.exclude).toContain('@domily/next/author');
    expect(resolved.optimizeDeps.exclude).toContain('business-api-client');
  });

  test('surfaces compiler locations on the original Vite file', () => {
    let error: unknown;
    try {
      transformDomilyAuthorModule(`
        import { action, defineDocument, state, view } from '@domily/next';
        export default defineDocument({
          id: 'invalid',
          state: state({ value: 0 }),
          actions: { update: action.set('value', () => 1) },
          view: view.text('nope'),
        });
      `, '/src/invalid.dmy.ts');
    } catch (caught) {
      error = caught;
    }

    expect(error).toBeInstanceOf(DomilyViteCompileError);
    expect(error).toMatchObject({
      code: 'dsl.value',
      id: '/src/invalid.dmy.ts',
      loc: expect.objectContaining({ line: 6 }),
    });
  });

  test('runs an optional host policy validator before emitting the module', () => {
    expect(() => transformDomilyAuthorModule(fixture, '/src/todos.dmy.ts', {
      validate: () => ({
        issues: [{ code: 'view.component.unknown', location: { column: 7, line: 4 }, message: 'Component is not registered.' }],
        ok: false,
      }),
    })).toThrow(DomilyViteCompileError);

    let error: unknown;
    try {
      transformDomilyAuthorModule(fixture, '/src/todos.dmy.ts', {
        validate: () => ({
          issues: [{ code: 'view.component.unknown', location: { column: 7, line: 4 }, message: 'Component is not registered.' }],
          ok: false,
        }),
      });
    } catch (caught) {
      error = caught;
    }
    expect(error).toMatchObject({ code: 'view.component.unknown', loc: { column: 6, line: 4 } });
  });

  test('runs as a real Vite pre-transform for an in-memory author module', async () => {
    const virtualId = '\0virtual:todos.dmy.ts';
    const server = await createServer({
      appType: 'custom',
      logLevel: 'silent',
      plugins: [
        domilyNext(),
        {
          name: 'domily-next-test-fixture',
          load(id) {
            return id === virtualId ? fixture : null;
          },
          resolveId(id) {
            return id === 'virtual:todos.dmy.ts' ? virtualId : null;
          },
        },
      ],
      server: { middlewareMode: true },
    });
    try {
      const transformed = await server.transformRequest('virtual:todos.dmy.ts');
      expect(transformed?.code).toContain('export default document;');
      expect(transformed?.code).not.toContain("from '@domily/next'");
    } finally {
      await server.close();
    }
  });
});
