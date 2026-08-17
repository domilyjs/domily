# 0019：原生 DOM Host MVP

- 状态：已实现（M2）
- 日期：2026-08-15
- 前置：[0015-minimal-core-and-extension-model.md](./0015-minimal-core-and-extension-model.md)、[0016-catalog-capability-contract.md](./0016-catalog-capability-contract.md)、[0018-pagespec-migration-and-mvp-plan.md](./0018-pagespec-migration-and-mvp-plan.md)

## 1. 目标

M2 交付一条不依赖 React、Vue 或 legacy `Document AST` 的浏览器路径：本地
TypeScript/JavaScript 传入 PageSpec，native DOM host 验证、挂载原始 HTML、读写宿主
显式提供的 scope，并将组件事件或生命周期调用到已注册的 capability。

它不引入表单、查询、列表、路由、全局状态或 action/workflow 语言。

```text
PageSpec
  → registry.snapshot() + normalizePageSpec()
  → PageHost（本地 renderer / capability / scope 快照）
  → 原生 DOM
  → 净化事件 payload
  → authorize → invoke
  → 宿主 scope 更新 → MVP 整树重渲染
```

## 2. 公开边界

新增两个 core 子路径：

- `@domily/next/dom`：`createPageHost`、scope provider、trusted renderer 与 capability handler 契约；
- `@domily/next/native-html`：`native-html` Catalog 及其原生 DOM 实现。

旧根入口、`app.ts`、`dom-host`、`renderer-dom`、`Document` 与 `ActionNode` 已删除；
M2 不保留 lowering 或兼容入口。

`PageRegistry` 继续只保存 JSON-compatible manifest。DOM renderer、capability handler、
scope 值、订阅和授权函数全部由本地 Host 单独注册，远程 PageSpec 无法携带或替换它们。

## 3. Host 契约

```ts
interface ScopeProvider {
  readonly extension?: string;
  readonly manifest: ScopeManifest;
  read(path: readonly string[]): JsonValue | undefined;
  write?(path: readonly string[], value: JsonValue): void | Promise<void>;
  subscribe?(listener: () => void): () => void;
}

interface CapabilityHandler {
  authorize?(context: PageCapabilityContext, args: JsonValue | undefined): boolean | Promise<boolean>;
  invoke(context: PageCapabilityContext, args: JsonValue | undefined): JsonValue | Promise<JsonValue>;
}

interface TrustedDomComponentRenderer {
  readonly type: string;
  mount(context: DomComponentContext): DomComponentMount;
}
```

挂载时 Host 先捕获 `registry.snapshot()`，再使用同一份 snapshot 做 normalize、renderer
匹配和 capability 匹配；中途新增的本地注册物不能改变正在挂载页面的语义。

Host 传入的 scope 同时提供 runtime 的读写能力与 normalizer 使用的 `ScopeManifest`，
从而不出现“校验时可见、运行时不可见”的隐式 `$state`。

未标记 `extension` 的 scope 是显式公开给页面的 host scope。标记 owner 的 scope 则只在 PageSpec 同时声明并
配置该 extension 时可见；PageHost 会验证 owner、name、mode 和 schema，普通同名 scope 不能替代 extension
provider。

## 4. Binding 与事件顺序

`readwrite` binding 必须在 Component manifest 中声明纯数据写入映射：

```ts
write: { event: 'input', valuePath: 'value' }
```

`event` 必须是该组件已声明事件，`valuePath` 是净化 payload 的安全路径。一次 DOM
事件的固定顺序是：

1. trusted renderer 投影 JSON-compatible payload；
2. 写回该事件涉及的绑定 scope；
3. materialize `on` 的 `$event` / `$scope` 参数；
4. capability runtime schema 校验、授权和调用。

所以 capability 可以读取同一输入事件刚写入的 scope，而无需旧 action DSL。

以 `$$` 开头的字面 `$` 必须保留 escape 到 render-time materialization，不能在
normalizer 阶段丢失并误当作 binding。

## 5. native-html 首批范围

首批包含 `html.fragment`、`html.text`、`html.div`、`html.main`、`html.section`、
`html.span`、`html.p`、`html.button`、`html.input`、`html.form` 与 `html.a`。

- `className` 和 `style` 直接传给 native HTML；视觉策略与 CSP 仍由业务/Host 决定；
- 其余原生属性由 `native-html` Catalog 显式声明；不会因 `additionalProperties` 自动开放 `ping`、
  `form`、`action`、`src` 等可绕开 capability 的浏览器行为；
- `innerHTML`、`outerHTML`、`srcdoc` 和 `on*` 在 normalizer、renderer 双层拒绝；
- `<a>` 仅允许相对 URL 或 HTTPS，`_blank` 自动带 `noopener noreferrer`；
- `form` 的 `submit` 无论是否配置 capability 都防止浏览器默认导航；
- native renderer 只投影 JSON 数据，绝不把 DOM `Event`、节点或函数交给 capability。

后续 HTML 标签只是 Catalog 扩展；`script`、`iframe` 和原始 HTML string 不属于本 MVP。

## 6. 生命周期与错误

1. `mount`：normalize → 预检本地实现 → 首次 DOM commit → scope subscribe → `mounted` capability；
2. `scope subscribe` 或 `mounted` 失败：清理已 commit 的 DOM、事件与订阅并拒绝 mount；
3. UI 事件失败：调用 `onError`，已挂载页面保持，不产生 unhandled rejection；
4. `unmount`：先调用 `unmounted`，无论其结果都 dispose、unsubscribe、清空 root，再传播 lifecycle 错误；
5. capability 结果不会被 core 自动写入 state；业务 handler 或 scope provider 自己决定后续状态。

## 7. 验收

- `html.*` + 一个本地 `app.*` renderer 可混合挂载；
- `className/style`、文本、children、slot、受控 input、submit、click 均可工作；
- 缺 renderer/handler/scope、未授权 capability、危险 prop 或不合 schema 的运行时参数都在安全边界失败；
- mount/unmount、scope subscription、焦点恢复和错误隔离有测试；
- 不引入旧 AST、Form/List/Resource 或 React/Vue 依赖。
