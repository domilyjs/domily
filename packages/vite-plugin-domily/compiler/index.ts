import {
  type JscConfig,
  type ModuleItem,
  parseSync,
  printSync,
  transform,
} from "@swc/core";
import type { VitePluginDomilyOptions } from "./utils";
import { codeDataBinding } from "./data-bing";

type Mode = "dev" | "build" | "unknown" | "scan";

interface ParseResult {
  script: string;
  json: string;
  style: string;
  ts: boolean;
  cssPreprocessor: string;
}

function filterCode(
  code: string,
  filter: (node: ModuleItem) => boolean,
  options: {
    ts?: boolean;
    mode?: Mode;
  },
) {
  const ast = parseSync(code, {
    syntax: options.ts ? "typescript" : "ecmascript",
  });
  const filteredAst = {
    ...ast,
    body: ast.body.filter(filter),
  };
  return printSync(filteredAst, { minify: options.mode !== "dev" }).code;
}

function JSC(ts: boolean) {
  const jsc: JscConfig = {
    parser: {
      syntax: ts ? "typescript" : "ecmascript",
      tsx: true,
      decorators: true,
    },
    target: "es2022",
    minify: {
      format: {
        indentLevel: 2,
      },
    },
  };
  return jsc;
}

function parse(code: string) {
  const codeBlockRegex = /```(\w*)\n([\s\S]*?)\n```/g;

  const result: ParseResult = {
    script: "",
    json: "",
    style: "",
    ts: false,
    cssPreprocessor: "css",
  };

  let match: RegExpExecArray | null = null;

  while ((match = codeBlockRegex.exec(code)) !== null) {
    // eslint-disable-next-line no-unused-vars
    const [_, lang, content] = match;
    const langLowerCase = lang.toLowerCase();
    switch (langLowerCase) {
      case "json":
        result.json = content;
        break;
      case "ts":
      case "typescript":
        result.ts = true;
        result.script = content;
        break;
      case "js":
      case "javascript":
        result.script = content;
        break;
      case "less":
      case "css":
      case "scss":
      case "sass":
        result.cssPreprocessor = langLowerCase;
        result.style = content;
        break;
      default:
        if (content.trim().startsWith("{")) {
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
  if (code.cssPreprocessor === "css") {
    return code;
  }
  if (code.cssPreprocessor === "less") {
    const less = await import("less").then((e) => e.default);
    const { css } = await less.render(code.style, { compress: mode !== "dev" });
    code.style = css;
  }
  if (["scss", "sass"].includes(code.cssPreprocessor)) {
    const sass = await import("sass").then((e) => e);
    const { css } = sass.compileString(code.style, {
      syntax: code.cssPreprocessor === "scss" ? "scss" : "indented",
      style: mode === "dev" ? "expanded" : "compressed",
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

async function generateCodeText({
  name,
  script,
  template,
  options,
  ts,
  mode,
}: {
  name: string;
  script: string;
  template: string;
  options: VitePluginDomilyOptions;
  ts: boolean;
  mode: Mode;
}) {
  const {
    customElement: { enable, prefix },
  } = options;

  const returnTemplate = enable
    ? `{ name: "${prefix}${name}", customElementComponent: ${template}}`
    : template;
  const imports = filterCode(script, (n) => n.type === "ImportDeclaration", {
    ts,
    mode,
  });
  const others = filterCode(script, (n) => n.type !== "ImportDeclaration", {
    ts,
    mode,
  });
  const withProps = [others, returnTemplate].some((e) => e.includes("props"))
    ? "props"
    : "";
  return `${imports}export default function(${withProps}){\n${others}return ${returnTemplate}\n}`;
}

export async function transformDOMSingleFileComponentCode(
  name: string,
  code: string,
  mode: Mode,
  options: VitePluginDomilyOptions,
) {
  const { script, style, json, ts } = await handleStyle(
    handleScript(parse(code)),
    mode,
  );
  const template = handleTemplateStyle(json, style);

  const codeText = await generateCodeText({
    name,
    script,
    template,
    options,
    ts,
    mode,
  });

  const result = await transform(codeText, {
    jsc: JSC(ts),
    minify: mode !== "dev",
    sourceMaps: mode === "dev",
  });

  return { code: result.code, map: result.map };
}
