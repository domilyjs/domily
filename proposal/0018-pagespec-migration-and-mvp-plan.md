# 0018：PageSpec 重构与 MVP 实施路线

- 状态：M1–M5 已实现；M6 待实现
- 日期：2026-08-15
- 前置：[0013-page-spec-product-reset.md](./0013-page-spec-product-reset.md)、[0015-minimal-core-and-extension-model.md](./0015-minimal-core-and-extension-model.md)、[0016-catalog-capability-contract.md](./0016-catalog-capability-contract.md)、[0017-source-codec-and-delivery-boundary.md](./0017-source-codec-and-delivery-boundary.md)

## 1. 决策

`domily-next` 仍处于内部验证期，因此不保留旧 `Document AST`、action runtime、作者宏、
compiler 或旧 DOM host 的兼容层。它们已经从源码、测试、构建入口和包导出中删除。

新的实现只有一条路径：

```text
本地 .dmy.ts / JSON、YAML、TOML、TOON、BSON source
  → codec：通用值 + parse-stage SourceMap
  → normalizePageSpec：唯一语义校验
  → PageRegistry manifest snapshot
  → PageHost：本地可信 renderer、scope、capability
  → 原生 DOM
```

这不是“保留旧框架、再加一个新 DSL”。它是一次有意的破坏性重构：公开模型只有高层
PageSpec；复杂业务逻辑保留在普通 TypeScript capability 或项目 Catalog 中。

## 2. 当前目录边界

```text
domily-next/
  core/src/
    pagespec/      # PageSpec、definePage、binding、normalizer
    registry/      # Catalog / capability / extension 纯数据 manifest
    codec/         # 格式无关 SourceCodec、SourceMap、registry
    dom/           # PageHost、scope、trusted renderer registry、DOM tree renderer
    native-html/   # 官方 html.* manifest 与本地 trusted DOM implementations
  codec-json/      # JSON text ↔ generic value + JSON Pointer SourceMap
  vite-plugin/     # .dmy.json 静态模块与可选 build-time normalizer
```

`@domily/next` 的根入口提供 PageSpec、registry、codec 和 DOM host 的易用导出；精确的
tree-shakable 子路径是 `/pagespec`、`/registry`、`/codec`、`/dom`、`/native-html`。Vite
插件始终单向依赖 core；具体文本 codec 始终是独立包。

## 3. 已完成阶段

### M1：PageSpec 与 manifest registry

- `PageSpec`、`UiNode`、`requires`、`on`、`bind`、lifecycle 的公开数据契约已实现；
- `normalizePageSpec()` 是唯一的语义入口，统一校验 Catalog、capability、extension、scope、
  binding、远程/本地授权和危险 DOM prop；
- `PageRegistry` 只保存 JSON-compatible 深冻结 manifest snapshot，绝不保存 renderer 或 handler；
- `$$` 字面 `$` 与 `$scope.path` binding 在 render-time 才区分，不会在 normalize 时丢失语义。

### M2：原生 DOM MVP

- `createPageHost()` 捕获同一次 mount 的 registry、renderer、capability 和 scope 快照；
- `native-html` 支持 `fragment`、`text`、`div`、`main`、`section`、`span`、`p`、`button`、
  `input`、`form`、`a`，并开放 `className`、`style`；
- host scope 是显式提供的，没有隐式 `$state`、`$form` 或全局状态策略；
- 事件顺序固定为：投影 JSON payload → 写入 readwrite binding → materialize invocation args →
  runtime schema → authorize → invoke；
- `on*`、`innerHTML`、`outerHTML`、`srcdoc`、不安全链接在 normalizer 和 native DOM sink 双层拒绝；
- mount/unmount、scope 重渲染、生命周期、错误隔离、renderer/handler/scope 预检均有测试。

### M3：JSON 与 Vite 作者体验

- `@domily/next-codec-json` 只 parse/serialize generic JSON，并在 parse 阶段分配
  `json:/...` SourceMap node ID；不再识别 `$ref`、`op`、`kind` 或动作节点；
- `.dmy.ts` 是普通受信任 TypeScript：`definePage()` 只提供类型帮助，不创建宏语言或 compiler；
- Vite plugin 处理 `.dmy.json` 为 import-free PageSpec module，并可选调用同一个
  `normalizePageSpec()` 做构建期诊断；它不会执行或编译一套 PageSpec 专用 JavaScript。

## 4. 接下来阶段

### M4：远程 envelope、缓存与离线

已重新实现 envelope v2，而不是恢复旧 loader：`@domily/next/delivery` 保存完整原 payload、
精确 codec ID/version、SHA-256、可选 Ed25519 宿主验签元数据、依赖 fingerprint 与 cache policy。
远程 envelope 默认必须签名；本地开发只能显式 `allowUnsigned: true`。网络和缓存命中都会重新进行
hash/签名、parse 与 remote normalize；缓存只保存 raw envelope，不保存旧 AST、source map 或执行计划。

缓存显示的新鲜度只由签名覆盖的 `issuedAt` / `expiresAt` 与 envelope cache policy 决定；本地 `acceptedAt`
仅作审计。过期 raw envelope 可作为不渲染的 revision watermark，以持续拒绝回滚；同一文档的持久化写入
通过 store 原子 compare-and-swap 完成，因此多个 client/标签共享缓存也不能由低 revision 覆盖高 revision。
extension-owned scope 必须显式标注 owner，只有 PageSpec 正确启用该 extension 后才会暴露给 delivery/Host。

`createMemoryPageEnvelopeStore()` 已用于测试与短生命周期宿主；持久化离线存储由同一
`PageEnvelopeStore` 接口接入，浏览器 IndexedDB adapter 留给后续独立交付，避免 core 预设应用的
存储/租户策略。缓存 namespace 必填，回滚 revision、同 revision 不同 hash、过期和篡改均拒绝。

### M5：可选业务预设（已实现）

Form、Resource、List、Router、pending/error/retry 都不是 core。需要时以单独
`business-page` Catalog/extension 实现短配置和项目政策；它不能修改 core normalizer，也不能要求
所有业务采用其状态模型。

[0020](./0020-trusted-extension-runtime-and-preset-admission.md) 已将该阶段进一步收敛并实现为：以受本地
信任的 extension runtime 为每次 mount 创建并清理 extension-owned scope，再用一个独立业务预设
`business.form` 垂直切片验证作者体验。Todo 与 Profile 两个独立 Vite 页面分别验证“表单 + 项目列表”和
“只用原生 HTML 的多字段资料表单”。runtime 不获得 DOM、网络、动态模块或 capability hook；远程页面只能
选择已部署且双重授权的 runtime。Host 会拒绝 public scope 冒充 extension scope，以及并发 mount 复用同一个
extension provider。`Resource/List/$item` 局部 scope、自动加载和异步工作流在有独立契约前仍不进入 core。

### M6：第二批 codec 与生态 adapter

先用共享 fixture 验证 YAML、TOON、TOML、BSON；随后才试验 React/Vue adapter。adapter 必须消费
相同的 PageSpec、registry、capability 和诊断，不能创造第二种作者语言。

## 5. 验收与风险

当前 M2/M3 的关键回归覆盖：manifest snapshot、local/remote 授权、动态 binding 二次 schema
校验、事件 payload JSON 化、DOM sink 防御、生命周期失败清理、JSON SourceMap、Vite JSON 诊断、
以及 Todo 业务示例。

有意延后的是持久化 storage adapter、Resource/List 等其他按需预设与第二批 codec/adapter；它们必须继续
使用新的 PageSpec 原 payload 契约，不能用旧 AST cache 或执行 runtime 伪装兼容。
