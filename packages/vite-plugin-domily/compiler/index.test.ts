import { describe, expect, test } from 'bun:test';
import { parseSync, transformWithOxc } from 'vite';

import { transformDOMSingleFileComponentCode } from './index';

const options = {
  customElement: {
    enable: false,
    prefix: 'd-',
  },
};

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
});
