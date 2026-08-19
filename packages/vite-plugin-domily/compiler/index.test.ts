import { describe, expect, test } from 'bun:test';
import { parseSync, transformWithOxc } from 'vite';

import domily from '../index';
import { codeDataBinding, templateUsesProps } from './data-binding';
import { transformDOMSingleFileComponentCode } from './index';

const options = {
  customElement: {
    enable: false,
    prefix: 'd-',
  },
};

function rawCompiler(generated: string[]) {
  return {
    parse: (code: string, parserOptions: Parameters<typeof parseSync>[2]) =>
      parseSync('example.ts', code, parserOptions),
    transform: async (code: string) => {
      generated.push(code);
      return { code };
    },
  };
}

describe('DOM single-file component compiler', () => {
  test('keeps imports at module scope and transpiles TypeScript through Vite Oxc', async () => {
    const result = await transformDOMSingleFileComponentCode(
      'example',
      `\`\`\`json
{ "tag": "div", "text": "hello" }
\`\`\`

\`\`\`ts
import value from './value';
const count: number = value;
\`\`\``,
      'dev',
      options,
      {
        parse: (code, parserOptions) => parseSync('example.ts', code, parserOptions),
        transform: (code, filename, transformOptions) => transformWithOxc(code, filename, transformOptions),
      },
      '/virtual/example.d.md',
    );

    expect(result.code).toMatch(/import\s+value\s+from\s*["']\.\/value["']/);
    expect(result.code).toContain('const count = value;');
    expect(result.code).toContain('export default function()');
    expect(result.code).toContain('"tag": "div"');
    expect(result.code).toContain('"text": "hello"');
    expect(result.map).toBeDefined();
  });

  test('uses the source parser only to separate import declarations', async () => {
    const parsedInputs: string[] = [];
    const result = await transformDOMSingleFileComponentCode(
      'example',
      `\`\`\`json
{ "tag": "div" }
\`\`\`

\`\`\`js
import { helper } from './helper';
const title = helper('ok');
\`\`\``,
      'build',
      options,
      {
        parse: (code) => {
          parsedInputs.push(code);
          return parseSync('example.js', code, { lang: 'js' });
        },
        transform: (code, filename, transformOptions) => transformWithOxc(code, filename, transformOptions),
      },
      '/virtual/example.d.md',
    );

    expect(parsedInputs).toEqual(["import { helper } from './helper';\nconst title = helper('ok');"]);
    expect(result.code).toMatch(/import\s*\{\s*helper\s*\}\s*from\s*["']\.\/helper["']/);
    expect(result.code).toMatch(/const\s+title\s*=\s*helper\(["']ok["']\)/);
  });

  test('keeps TSX and legacy decorators parseable by the Oxc path', async () => {
    const result = await transformDOMSingleFileComponentCode(
      'example',
      `\`\`\`json
{ "tag": "div" }
\`\`\`

\`\`\`ts
@sealed
class Example {}
const view = <div />;
\`\`\``,
      'dev',
      options,
      {
        parse: (code, parserOptions) => parseSync('example.tsx', code, {
          ...parserOptions,
          lang: 'tsx',
        }),
        transform: (code, filename, transformOptions) => transformWithOxc(code, filename, {
          ...transformOptions,
          lang: 'tsx',
          jsx: { pragma: 'h', runtime: 'classic' },
        }),
      },
      '/virtual/example.d.md',
    );

    expect(result.code).toContain('class Example');
    expect(result.code).toContain('h("div", null)');
  });

  test('emits only explicit data and event bindings as expressions', () => {
    expect(
      codeDataBinding(
        JSON.stringify({
          props: {
            value: ':props.title',
            literal: 'props.title',
          },
          on: { click: '@onClick' },
          style: { content: ':notAnExpression' },
        }),
      ),
    ).toBe(
      '{"props":{"value":props.title,"literal":"props.title"},"on":{"click":onClick},"style":{"content":":notAnExpression"}}',
    );
  });

  test('does not reinterpret literal values that resemble the old compiler sentinels', () => {
    expect(
      codeDataBinding(
        JSON.stringify({
          text: '___DOMILY_DATA_BING:props.title',
          title: '___DOMILY_EVENT_BING:onClick',
        }),
      ),
    ).toBe(
      '{"text":"___DOMILY_DATA_BING:props.title","title":"___DOMILY_EVENT_BING:onClick"}',
    );
  });

  test('requires event bindings to reference a handler instead of calling it during render', () => {
    expect(() => codeDataBinding('{ "on": { "click": "@onClick()" } }')).toThrow(
      'Event bindings must reference a handler',
    );
  });

  test('rejects malformed data-binding calls before generating JavaScript', () => {
    expect(() => codeDataBinding('{ "text": ":handler(" }')).toThrow(
      'Invalid Domily data binding',
    );
    expect(codeDataBinding('{ "text": ":handler(props.id,2)" }')).toBe(
      '{"text":handler(props.id,2)}',
    );
  });

  test('detects props only in explicit binding expressions', () => {
    expect(templateUsesProps('{ "className": "props-panel" }')).toBeFalse();
    expect(templateUsesProps('{ "props": { "value": ":props.title" } }')).toBeTrue();
  });

  test('preserves JSON __proto__ as an own data property', () => {
    const generated = codeDataBinding(
      '{"__proto__":{"polluted":true},"tag":"div"}',
    );
    const value = new Function(`return (${generated});`)() as Record<string, unknown>;

    expect(Object.getPrototypeOf(value)).toBe(Object.prototype);
    expect(Object.hasOwn(value, '__proto__')).toBe(true);
    expect(value.__proto__).toEqual({ polluted: true });
  });

  test('serializes CSS as a string literal instead of interpolating it into a template literal', async () => {
    const generated: string[] = [];
    const style = 'a::before { content: `literal ${notCode}`; }';
    await transformDOMSingleFileComponentCode(
      'example',
      `\`\`\`json
{ "tag": "div" }
\`\`\`

\`\`\`css
${style}
\`\`\``,
      'dev',
      options,
      rawCompiler(generated),
      '/virtual/example.d.md',
    );

    expect(generated).toHaveLength(1);
    expect(generated[0]).toContain(`text: ${JSON.stringify(style)}`);
    expect(generated[0]).not.toContain('text: `');

    await expect(
      transformWithOxc(generated[0]!, '/virtual/example.d.md', {
        decorator: { legacy: true },
        lang: 'js',
        sourcemap: true,
        target: 'es2022',
      }),
    ).resolves.toBeDefined();
  });

  test('accepts CRLF fenced sections and rejects duplicate sections clearly', async () => {
    const generated: string[] = [];
    await transformDOMSingleFileComponentCode(
      'example',
      '```json\r\n{ "tag": "div" }\r\n```\r\n\r\n```js\r\nconst value = 1;\r\n```',
      'dev',
      options,
      rawCompiler(generated),
      '/virtual/example.d.md',
    );
    expect(generated[0]).toContain('const value = 1;');

    await expect(
      transformDOMSingleFileComponentCode(
        'example',
        '```json\n{ "tag": "div" }\n```\n```json\n{ "tag": "span" }\n```',
        'dev',
        options,
        rawCompiler([]),
        '/virtual/example.d.md',
      ),
    ).rejects.toThrow('Duplicate Domily json section');
  });

  test('normalizes custom-element names before code generation', async () => {
    const generated: string[] = [];
    await transformDOMSingleFileComponentCode(
      'My Component',
      '```json\n{ "tag": "div" }\n```',
      'dev',
      { customElement: { enable: true, prefix: '' } },
      rawCompiler(generated),
      '/virtual/My Component.d.md',
    );

    expect(generated[0]).toContain('name: "my-component"');
  });

  test('does not add a props parameter for literal strings or imported bindings named props', async () => {
    const generated: string[] = [];
    await transformDOMSingleFileComponentCode(
      'example',
      `\`\`\`json
{ "tag": "div", "className": "props-panel" }
\`\`\`

\`\`\`js
import { props } from './helpers';
console.log(props);
\`\`\``,
      'dev',
      options,
      rawCompiler(generated),
      '/virtual/example.d.md',
    );

    expect(generated[0]).toContain('export default function()');
    expect(generated[0]).toContain("console.log(props);");
  });

  test('adds a props parameter when an explicit template binding needs it', async () => {
    const generated: string[] = [];
    await transformDOMSingleFileComponentCode(
      'example',
      '```json\n{ "tag": "div", "text": ":props.title" }\n```',
      'dev',
      options,
      rawCompiler(generated),
      '/virtual/example.d.md',
    );

    expect(generated[0]).toContain('export default function(props)');
  });

  test('recognizes SFC ids with Vite query strings', async () => {
    const plugin = domily({ customElement: { enable: true, prefix: '' } });
    const transform = plugin.transform;
    if (typeof transform !== 'function') {
      throw new TypeError('Expected Domily to register a transform hook.');
    }

    const result = await transform.call(
      {
        environment: { mode: 'dev' },
        parse: (source: string, parserOptions: Parameters<typeof parseSync>[2]) =>
          parseSync('example.ts', source, parserOptions).program,
      } as never,
      '```json\n{ "tag": "div" }\n```',
      '/virtual/My Component.d.md?import',
    );

    expect(result).toBeDefined();
    expect(typeof result === 'string' ? result : result?.code).toContain('my-component');
  });
});
