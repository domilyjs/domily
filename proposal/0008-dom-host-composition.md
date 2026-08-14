# 0008：端到端 DOM Host 组合、文档切换与本地开发入口

- 状态：MVP 已实现
- 日期：2026-08-14
- 关联：[0004-document-delivery.md](./0004-document-delivery.md)、[0005-html-component-policy.md](./0005-html-component-policy.md)、[0006-action-runtime.md](./0006-action-runtime.md)、[0007-dom-renderer-adapter.md](./0007-dom-renderer-adapter.md)

## 1. 决策

核心包内部的 DOM host 模块作为浏览器应用壳的组合入口；业务侧通过 `@domily/next` 的 `createDomilyApp()` 使用它。它不创造新的协议语义，而是以固定顺序组装现有边界：

```text
Envelope / local Document
  -> codec + integrity + signature + cache (DocumentLoader)
  -> component/capability policy (validator)
  -> transactional actions (DocumentRuntime)
  -> trusted DOM registry (DomRenderer)
  -> root element
```

调用方不应分别手动创建 loader、validator、runtime 和 renderer；那会使 capability 集、组件 registry、错误处理和 revalidation 策略在多个位置漂移。host 从一份 `capabilities + components + delivery` 配置中构造 loader，并把同一 DOM registry 同时交给 validator 与 renderer。

## 2. API 与信任边界

```ts
const host = new DomilyDomHost({
  codecs,
  store,
  fetchEnvelope,
  verifyEnvelope,
  capabilities: {
    'todos.list': listTodos,
    'todos.create': createTodo,
  },
  components: createMvpDomRegistry(),
  onError,
});

await host.mount('todos', root);          // 服务端/缓存文档
await host.mountDocument(localDoc, root); // 本地 DSL 编译产物
```

`capabilities` 是可信宿主函数；Document 只能声明和调用其名称。`components` 是可信 registry，其中每个 definition 同时公开 validator 使用的 `props/events` 集合和 renderer 使用的 writer/projector，因此一份配置不能在两个阶段产生不同允许面。

Host 不接受文档携带的 capability、registry、validator、DOM node 或 JavaScript callback。

## 3. 挂载与错误语义

### 3.1 服务端文档

`mount(id, root)` 先经 `DocumentLoader.load()`，再创建新的 runtime 和 renderer。loader 失败时保留当前已挂载页面；只有新文档已完整通过 codec、hash、signature、validator 并成功创建后，host 才卸载旧 renderer、执行其 `unmounted` 生命周期并挂载新文档。

本地 `mountDocument(document, root)` 也会 freeze 并执行同一 validator，只跳过 envelope、缓存和签名步骤。它是 DSL/Vite 本地开发的入口，不是绕过安全策略的入口。

### 3.2 错误出口

所有错误经 `onError({ phase, error, document? })` 报给宿主，phase 为 `load`、`validation`、`runtime`、`renderer` 或 `revalidate`。host 自己不在 DOM 中注入错误 HTML；宿主可使用自己的可信 fallback UI、日志和 trace 管道。

`mount()` 与 `mountDocument()` 失败后 reject；事件内动作失败由 renderer 捕获并仅进入 `onError`，避免浏览器的未处理 Promise。`unmount()` 即使生命周期失败也会清理 subscription 与 root，然后 rethrow。

## 4. 文档版本与 revalidation

来自 loader 的 `revalidate` 默认自动观察，但只在以下条件下替换当前页面：

1. 本次 mount generation 仍是当前 generation；
2. document id 相同；
3. envelope `revision` 严格大于当前 revision。

相同或更低 revision 即使 payload 不同也不会覆盖已运行页面，并作为 host 诊断处理；这避免 CDN/cache 的乱序响应让旧内容回滚。MVP 更新以“卸载旧 document → 创建新 runtime → 挂载新 document”完成，state 不迁移，新的 document 从其初始 state 开始。

这不是热更新协议。状态迁移、revision schema migration、增量 DOM swap 和冲突合并在未来另立提案。

## 5. 运行时 props、trace 与生命周期

host 可为每份 Document 提供 JSON-compatible `props`（固定值或可信 resolver），并可接收 runtime trace。props 仅传给受限 expression / capability context，不能携带函数、DOM node 或任意宿主对象。

renderer 挂载时运行标准 `mounted`，切换或卸载时运行 `unmounted`。Host 不额外创造 `loaded`、`routeChanged`、`visibilityChanged` 等伪生命周期；宿主若需要这些场景，显式调用 action 或提供 capability。

## 6. MVP 验收

1. 一份 host 配置同时驱动 loader validator、runtime capability 与 renderer registry；
2. `mount()` 对 envelope 的 hash/validator 失败不破坏当前页面；
3. `mountDocument()` 对本地 AST 执行同一 validator；
4. 新 revision 的 revalidate 正确替换页面，过期/乱序 revision 不替换；
5. 切换和失败路径无 renderer subscription 泄漏；
6. Todo “表单 + 列表” fixture 能以 memory store、mock capability 和 fake DOM 完成从 payload 到交互的端到端测试。

## 7. 非目标

- 路由、认证 UI、fallback UI 或权限业务规则；
- 自动把 legacy Domily schema 转换为 Next Document；
- 多文档嵌套挂载、portal、热模块更新；
- service worker、后台同步或跨标签页状态共享。
