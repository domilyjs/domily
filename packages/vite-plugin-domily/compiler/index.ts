import { codeDataBinding, templateUsesProps } from './data-binding';
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
  usesProps: boolean;
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

type Section = "json" | "script" | "style";

function parse(code: string) {
  const codeBlockRegex = /```([^\r\n`]*)\r?\n([\s\S]*?)\r?\n```/g;

  const result: ParseResult = {
    script: '',
    json: '',
    style: '',
    ts: false,
    usesProps: false,
    cssPreprocessor: 'css',
  };

  const sections = new Set<Section>();
  const setSection = (section: Section, content: string, lang: string) => {
    if (sections.has(section)) {
      throw new SyntaxError(
        `Duplicate Domily ${section} section (${lang || "unlabelled"}).`,
      );
    }

    sections.add(section);
    if (section === "json") {
      result.json = content;
      return;
    }
    if (section === "script") {
      result.script = content;
      return;
    }
    result.style = content;
  };

  let match: RegExpExecArray | null = null;

  while ((match = codeBlockRegex.exec(code)) !== null) {
    const [, lang = '', content = ''] = match;
    const langLowerCase = lang.trim().toLowerCase();
    switch (langLowerCase) {
      case 'json':
        setSection('json', content, lang);
        break;
      case 'ts':
      case 'typescript':
        result.ts = true;
        setSection('script', content, lang);
        break;
      case 'js':
      case 'javascript':
        setSection('script', content, lang);
        break;
      case 'less':
      case 'css':
      case 'scss':
      case 'sass':
        result.cssPreprocessor = langLowerCase;
        setSection('style', content, lang);
        break;
      default:
        if (content.trim().startsWith('{')) {
          setSection('json', content, lang);
        } else if (/(const|let|function)\s/.test(content)) {
          setSection('script', content, lang);
        } else if (/(\.|#)[\w-]+\s*{/.test(content)) {
          setSection('style', content, lang);
        }
    }
  }

  if (!sections.has('json')) {
    throw new SyntaxError('A Domily component must contain one JSON template section.');
  }

  return result;
}

function handleScript(code: ParseResult) {
  code.usesProps = templateUsesProps(code.json);
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
                text: ${JSON.stringify(style)}
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
  usesProps,
  compiler,
}: {
  name: string;
  script: string;
  template: string;
  options: VitePluginDomilyOptions;
  ts: boolean;
  usesProps: boolean;
  compiler: OxcCompiler;
}) {
  const { enable = false, prefix = 'd-' } = options.customElement ?? {};
  const returnTemplate = enable
    ? `{ name: ${JSON.stringify(normalizeCustomElementName(prefix, name))}, customElementComponent: ${template}}`
    : template;
  const { imports, statements } = splitModuleSource(script, compiler, ts);
  const scriptMentionsProps = /\bprops\b/.test(statements);
  const scriptDefinesProps = /\b(?:const|let|var|function|class)\s+props\b/.test(
    statements,
  );
  const scriptImportsProps = /\bimport[\s\S]*?\bprops\b[\s\S]*?\bfrom\b/.test(
    imports,
  );
  const withProps =
    usesProps || (scriptMentionsProps && !scriptDefinesProps && !scriptImportsProps)
      ? 'props'
      : '';
  return `${imports}\nexport default function(${withProps}){\n${statements}\nreturn ${returnTemplate}\n}`;
}

function normalizeCustomElementName(prefix: string, name: string) {
  const normalized = `${prefix}${name}`
    .toLowerCase()
    .replaceAll(/[^a-z0-9._-]+/g, '-')
    .replaceAll(/^-+|-+$/g, '');

  if (!normalized) {
    return 'd-component';
  }

  return normalized.includes('-') ? normalized : `d-${normalized}`;
}

export async function transformDOMSingleFileComponentCode(
  name: string,
  code: string,
  mode: Mode,
  options: VitePluginDomilyOptions,
  compiler: OxcCompiler,
  filename: string,
) {
  const { script, style, json, ts, usesProps } = await handleStyle(handleScript(parse(code)), mode);
  const codeText = generateCodeText({
    name,
    script,
    template: handleTemplateStyle(json, style),
    options,
    ts,
    usesProps,
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
