# 0009：Vite 作者 DSL 编译、诊断与本地 AST 模块

- 状态：MVP 已实现
- 日期：2026-08-14
- 关联：[0003-authoring-dsl.md](./0003-authoring-dsl.md)、[0008-dom-host-composition.md](./0008-dom-host-composition.md)

## 1. 决策

新增独立包 `@domily/next-vite-plugin`，在 Vite 的 `pre` transform 阶段将 `.dmy.ts` 编译为纯 Document AST ES module。它单向依赖 `@domily/next`，core 不依赖 Vite 或该插件：

```ts
import todoDocument from './todo.dmy.ts';
import { createDomilyApp } from '@domily/next';

await createDomilyApp({ capabilities }).mount(todoDocument, root);
```

转换后的模块不保留 DSL import、宏调用、函数、闭包或任意作者 JavaScript：

```ts
const document = { /* JSON-compatible Document AST */ };
export { document };
export default document;
```

`createDomilyApp().mount()` 会在运行时 freeze 并执行与远程 envelope 相同的 component/capability validator。Vite plugin 还可以在构建期执行同一 validator，从而将允许面错误提前到编辑/构建阶段。

## 2. 职责划分

| 层 | 职责 |
| --- | --- |
| `@domily/next/compiler` | core 的 adapter-facing compiler 子路径；读取 TypeScript AST，拒绝任意执行，产出 Document AST/CodecIssue。 |
| `@domily/next-vite-plugin` | 文件匹配、错误定位、AST module 生成、可选 host validator 调用。 |
| Vite / Rolldown / Oxc | 正常应用模块的解析、转译、依赖图和 HMR。 |
| `@domily/next` 内部 DOM host | 本地 AST 的最终 freeze、验证、runtime、renderer 挂载。 |

插件不调用 `eval`、不执行作者模块，也不为 JSON-only 生成代码额外调用 `transformWithOxc`。生成模块没有 TypeScript、JSX 或需要转译的语法；再做一次转译只增加成本。Vite 对其余应用模块仍使用自身的 Oxc/Rolldown pipeline。

当前 static compiler 的 AST parser 实现是独立内部细节；将其从现有 parser 迁移到 Oxc AST 是单独的编译器重构，不应与 Vite adapter 混在一起。

## 3. 文件与模块约定

- 默认只处理 `.dmy.ts`；`extensions` 可显式增加其他受控扩展名；
- query string 不改变 DSL 语义，`?domily=ast` 与默认导入均导出同一 AST data module；
- 默认导出和命名导出 `document` 指向同一 AST 值；
- 原始 `.dmy.ts` 的 `@domily/next/author` import 永远不会进入 browser bundle，因此该 DSL namespace 不是运行时 capability；
- 插件自动将 `@domily/next/author` 排除在 Vite 开发期 dependency optimization 之外；预扫描早于 `pre` transform，不能要求业务项目手工规避一个编译期 import；
- 生产构建将 AST 内联到应用包。独立 JSON/envelope 输出由 delivery pipeline 决定，不由 Vite plugin 隐式写文件。

## 4. 诊断与校验

`compileAuthorModule()` 返回的 `CodecIssue.location` 被转换为 Vite/Rolldown error 的 `id + line + column`。这样闭包、动态值、非法 DSL 构造器、静态 const 前向引用等错误都定位到 `.dmy.ts` 作者文件。

插件 options 可提供：

```ts
interface DomilyNextVitePluginOptions {
  extensions?: readonly string[];
  validate?: (document: Document) => { ok: boolean; issues: readonly CodecIssue[] };
}
```

典型 `domilyVite()` 配置从业务 capability 记录推导与运行时相同的 validator：

```ts
domilyVite({ capabilities });
```

这不是安全唯一防线：本地 AST 仍由 host 重验，远程 AST 仍走 loader/validator。

## 5. HMR

插件不自作主张接管 HMR，也不在生成模块中注入 `import.meta.hot.accept()`。Vite 负责更新 DSL 生成模块并沿正常依赖边界传播；应用入口或未来的可信开发 helper 决定何时调用 `app.mount()` 替换页面。

这避免“热更新时悄悄执行新 author code”或把 HMR 变成新的 runtime 语义。下一阶段若需要 state-preserving local document hot swap，必须与 0008 的 revision/state migration 一起单独定义。

## 6. MVP 验收

1. `.dmy.ts` 只经过 static compiler，输出无 DSL import 的 AST ES module；
2. DSL 和 validator 错误能保留原始 Vite 文件位置；
3. 非 `.dmy.ts` 文件返回 `null`，不会干扰普通 Vite/Oxc pipeline；
4. 生成模块可直接被 `createDomilyApp().mount()` 使用；
5. compiler fixture、非法 DSL fixture、host policy fixture 均有插件级回归测试；
6. Vite plugin 只把 Vite 与 core 作为 peer；core 不声明 Vite peer 或依赖；compiler parser 仍是 core 的 Node/build-time 支持实现，不进入普通浏览器应用产物。

## 7. 非目标

- `.dmy` 模板语法、JSX、SFC 或 TS macro 执行；
- 自动生成 JSON/envelope 文件、服务端发布或签名；
- 自动 HMR mount、state migration 或热更新 capability；
- 将普通 `.ts` 文件当作 Domily author document。
