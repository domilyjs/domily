import { codeDataBinding } from './data-binding';
import type { VitePluginDomilyOptions } from './utils';

export type Mode = 'dev' | 'build' | 'unknown' | 'scan';

interface SourceSpan {
  start: number;
  end: number;
}

interface ParsedProgram {
  body: Array<SourceSpan & { type: string }>;
}

export interface OxcCompiler {
  parse(
    code: string,
    options: { lang: 'js' | 'ts' | 'jsx' | 'tsx'; sourceType: 'module' },
  ): { program: ParsedProgram };
  transform(
    code: string,
    filename: string,
    options: {
      decorator: { legacy: true };
      lang: 'js' | 'ts' | 'jsx' | 'tsx';
      sourcemap: boolean;
      target: string;
    },
  ): Promise<{ code: string; map?: { mappings: string } }>;
}

interface ParseResult {
  script: string;
  json: string;
  style: string;
  ts: boolean;
  cssPreprocessor: string;
}

function splitModuleSource(code: string, compiler: OxcCompiler, ts: boolean) {
  const { program } = compiler.parse(code, {
    lang: ts ? 'tsx' : 'js',
    sourceType: 'module',
  });
  const imports: string[] = [];
  const statements: string[] = [];

  for (const statement of program.body) {
    const source = code.slice(statement.start, statement.end);
    if (statement.type === 'ImportDeclaration') {
      imports.push(source);
    } else {
      statements.push(source);
    }
  }

  return {
    imports: imports.join('\n'),
    statements: statements.join('\n'),
  };
}

function parse(code: string) {
  const codeBlockRegex = /```(\w*)\n([\s\S]*?)\n```/g;

  const result: ParseResult = {
    script: '',
    json: '',
    style: '',
    ts: false,
    cssPreprocessor: 'css',
  };

  let match: RegExpExecArray | null = null;

  while ((match = codeBlockRegex.exec(code)) !== null) {
    const [, lang = '', content = ''] = match;
    const langLowerCase = lang.toLowerCase();
    switch (langLowerCase) {
      case 'json':
        result.json = content;
        break;
      case 'ts':
      case 'typescript':
        result.ts = true;
        result.script = content;
        break;
      case 'js':
      case 'javascript':
        result.script = content;
        break;
      case 'less':
      case 'css':
      case 'scss':
      case 'sass':
        result.cssPreprocessor = langLowerCase;
        result.style = content;
        break;
      default:
        if (content.trim().startsWith('{')) {
          result.json = content;
        } else if (/(const|let|function)\s/.test(content)) {
          result.script = content;
        } else if (/(\.|#)[\w-]+\s*{/.test(content)) {
          result.style = content;
        }
    }
  }
  return result;
}

function handleScript(code: ParseResult) {
  code.json = codeDataBinding(code.json);
  return code;
}

async function handleStyle(code: ParseResult, mode: Mode) {
  if (code.cssPreprocessor === 'css') {
    return code;
  }
  if (code.cssPreprocessor === 'less') {
    const less = await import('less').then((entry) => entry.default);
    const { css } = await less.render(code.style, { compress: mode !== 'dev' });
    code.style = css;
  }
  if (['scss', 'sass'].includes(code.cssPreprocessor)) {
    const sass = await import('sass').then((entry) => entry);
    const { css } = sass.compileString(code.style, {
      syntax: code.cssPreprocessor === 'scss' ? 'scss' : 'indented',
      style: mode === 'dev' ? 'expanded' : 'compressed',
    });
    code.style = css;
  }
  return code;
}

function handleTemplateStyle(json: string, style: string) {
  const template = style.trim()
    ? `{
        tag: 'fragment',
        children: [
          {
            tag: 'style',
            children: [
              {
                tag: 'text',
                text: \`${style}\`
              }
            ]
          },
          ${json}
        ]
      }`
    : json;
  return template;
}

function generateCodeText({
  name,
  script,
  template,
  options,
  ts,
  compiler,
}: {
  name: string;
  script: string;
  template: string;
  options: VitePluginDomilyOptions;
  ts: boolean;
  compiler: OxcCompiler;
}) {
  const { enable = false, prefix = 'd-' } = options.customElement ?? {};
  const returnTemplate = enable
    ? `{ name: "${prefix}${name}", customElementComponent: ${template}}`
    : template;
  const { imports, statements } = splitModuleSource(script, compiler, ts);
  const withProps = [statements, returnTemplate].some((entry) => entry.includes('props')) ? 'props' : '';
  return `${imports}\nexport default function(${withProps}){\n${statements}\nreturn ${returnTemplate}\n}`;
}

export async function transformDOMSingleFileComponentCode(
  name: string,
  code: string,
  mode: Mode,
  options: VitePluginDomilyOptions,
  compiler: OxcCompiler,
  filename: string,
) {
  const { script, style, json, ts } = await handleStyle(handleScript(parse(code)), mode);
  const codeText = generateCodeText({
    name,
    script,
    template: handleTemplateStyle(json, style),
    options,
    ts,
    compiler,
  });
  const result = await compiler.transform(codeText, filename, {
    decorator: { legacy: true },
    lang: ts ? 'tsx' : 'js',
    sourcemap: mode === 'dev',
    target: 'es2022',
  });

  return { code: result.code, map: result.map };
}
