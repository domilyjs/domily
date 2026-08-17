# 0020：可信 extension runtime 与业务预设准入

- 状态：M5 已实现；business-form 已在两个独立业务页面中验证
- 日期：2026-08-16
- 前置：[0015-minimal-core-and-extension-model.md](./0015-minimal-core-and-extension-model.md)、[0016-catalog-capability-contract.md](./0016-catalog-capability-contract.md)、[0019-native-dom-host-mvp.md](./0019-native-dom-host-mvp.md)
- 取代：无；它把 0015 中“业务 extension 可提供 scope/runtime”的原则收敛为可实现的原生 DOM 首版契约

## 1. 要解决的产品问题

`PageSpec` 已经避免了把执行 AST 暴露给作者，但纯 `html.*` + 项目组件仍会让常见业务页面显得冗长：
页面作者要展开标签层级、受控输入和项目状态的连接方式；AI 也需要重复生成这些机械结构。

解决方案不是把 `try`、`if`、`load`、`reset`、临时变量或任意 JavaScript 再次塞进 JSON。正确的分层是：

```text
PageSpec（作者/AI/服务端可写的纯数据）
  └── 已声明的 extension 配置 + Catalog 组件组合
          │
          ▼
本地已部署的业务预设
  ├── Extension manifest：config / scope / delivery 契约
  ├── Trusted extension runtime：每次挂载的局部 scope
  ├── Component Catalog + DOM renderer：表单、字段、列表等视觉/交互约定
  └── Capability handler：网络、认证、领域规则与副作用
```

core 仍不定义 Form、Resource、List、Router、重试、空态或设计系统；它只提供让这些**可选预设**安全接入的最小宿主机制。

## 2. 决策

M5 不先实现一个可插任意 hook 的“插件引擎”，也不发布通用业务工作流语言。

第一步实现一个只面向原生 DOM Host 的、受本地信任边界约束的 extension runtime 注册表；其 runtime 在每次 `mount()` 中只能创建 extension-owned scope，并在卸载时清理。随后用一个独立、可 tree-shake 的 `business-form` 垂直切片验证作者体验，而不是把它合并进 core 根入口。

以下能力不属于 M5：

- 页面配置中的函数、闭包、模块 URL、动态 import、网络请求；
- `before/after capability`、`transform node`、任意事件 hook、action steps 或工作流编排；
- extension 运行时注册/替换 Catalog、renderer、capability 或 registry manifest；
- component/slot 的词法局部 scope、`$item` repeat 模型；
- Vue、React adapter，异步 activation，自动资源加载。

这保证「配置驱动交互」仍然是**声明已部署能力的组合**，而不是「配置驱动执行任意程序」。

## 3. Manifest、runtime 与实现的边界

`ExtensionManifest` 继续是 JSON-compatible 的注册表数据：它描述 ID、版本、config schema、scope contract、transitive Catalog/capability 依赖和 remote delivery 权限。它不能保存函数或 renderer。

新增的 runtime 注册表不属于 `PageRegistry`，因为它保存的是本地可执行实现。应用启动时必须分别注册：

1. extension manifest 到 `PageRegistry`；
2. component manifest 到 `PageRegistry`，trusted renderer 到 DOM renderer registry；
3. capability manifest 到 `PageRegistry`，capability handler 到 `PageHost`；
4. trusted extension runtime 到专用 runtime registry。

PageSpec 只能通过 `requires.extensions` 与 `extensions[id]` 选择第 1 项的 manifest/config；它不能声明、下载、替换或参数化第 4 项的代码。

```ts
interface TrustedPageExtensionRuntime {
  readonly id: string;
  readonly version: string;
  /** Defaults to false. It is an additional local policy, never an override. */
  readonly allowRemote?: boolean;

  /** M5 is synchronous and creates state for exactly one mount. */
  activate(context: PageExtensionActivationContext): PageExtensionActivation;
}

interface PageExtensionActivationContext {
  readonly config: JsonValue;
  readonly id: string;
  readonly origin: 'local' | 'remote';
  readonly pageId: string;
  readonly registry: PageRegistrySnapshot;
  readonly version: string;
}

interface PageExtensionActivation {
  readonly dispose?: () => void | Promise<void>;
  readonly scopes?: readonly PageScopeProvider[];
}

interface PageExtensionRuntimeRegistry {
  register(runtime: TrustedPageExtensionRuntime): void;
  snapshot(): PageExtensionRuntimeRegistrySnapshot;
}
```

`config` 必须是 normalizer 已验证后防御性复制/冻结的 `extensions[id]` 值；它不是原始 source 对象。上下文故意不提供 Host、挂载 DOM、capability handler map、registry mutation API 或网络/模块加载 API。

这里的限制是框架的公开协作接口，而不是试图 sandbox 已安装的 JavaScript：本地 runtime 本身是受应用信任的代码。真正的远程边界始终是「远程 payload 没有任何指向新代码的途径」。

## 4. 挂载、校验与清理顺序

PageHost 对一次挂载捕获 registry、renderer、capability、静态 scope 和 runtime registry 的快照。顺序必须固定：

1. 用现有 `normalizePageSpec()` 校验 PageSpec、requires、namespaced extension config、Catalog/capability 的版本及 origin 权限；此阶段只传入普通 host scope，不能提前暴露 extension-owned scope；若普通 scope 与已启用 extension contract 同名，立即拒绝，不能以相同 schema “履约”；
2. 按规范化 `requires.extensions` 的顺序解析每个 extension，找到同 ID 的本地 runtime，并要求 runtime `id/version` 与已解析 manifest 精确一致；
3. 对远程页面同时要求 extension manifest `delivery.remotePage === true` 与 runtime `allowRemote === true`；缺一不可；
4. 调用同步 `activate()`，把 validated config 交给本地 runtime；每次 mount 必须得到新 activation，不能复用上一次页面的可变 scope。Host 会在同一 Host 的活跃 mount 之间拒绝复用**同一个 provider 对象**，并在 dispose 后释放该租约；不同 provider 包装同一私有 store 仍属于本地受信 runtime 的实现责任；
5. 严格校验 activation 返回的 scope：
   - `provider.extension === extension.id`；
   - name、mode、value schema 与 manifest scope contract 完全相同；
   - 不缺失、不额外、不重名，且不能覆盖普通 host scope 或其他 extension scope；
   - 当前协议的 binding scope 仅按 name 定位，因此所有活跃 extension scope 名必须全局唯一；
6. 合并静态与 activation scope 后完成预检、render、mounted lifecycle；
7. 任何失败按已 activation 的逆序调用 `dispose()`，且 DOM 不得提交或必须清空；成功页面在 unmounted lifecycle 之后，同样逆序 dispose activation。

M5 不复制 normalizer 的 extension 语义。若为了 activation 需要暴露内部的“已解析 extension”结果，应把该结果抽为 normalizer 与 Host 共用的私有阶段，而不是由 Host 重写一套 config/版本/remote 校验。

## 5. Capability 与副作用边界

runtime activation 只创建局部状态和订阅；它没有 capability invocation API。所有副作用继续走唯一的既有出口：

```text
PageSpec lifecycle / component event
  → declared capability invocation
  → runtime materialization + input schema
  → local authorize
  → local handler invoke
```

因此 M5 首版的业务预设不得把 `autoLoad`、`onSuccess`、`retry` 等隐式调用藏在 extension config 中。需要加载时，作者用明确的 `lifecycle.mounted → capability`；需要复杂编排时，使用一个普通 TypeScript capability 或等待未来单独提案的、可审计 capability broker。

这也避免 extension config 通过一个看似普通的 capability 名称获取未声明权限。`requires.capabilities`、manifest compatibility、local/remote invocation 权限、输入 schema 与 `authorize()` 都继续由 Host 统一执行。

## 6. Delivery 与离线缓存

Delivery 在验签、缓存命中、parse 和 normalize 时绝不执行 runtime activation。它只接受 runtime registry 的**可读可用性快照**，验证：

- 本地是否已部署同 ID/精确版本 runtime；
- 若是远程页面，runtime 是否 `allowRemote`；
- runtime 声明的 scope contract 是否与 manifest 一致。

动态 activation 只在真正的 `PageHost.mount()` 发生。这样缓存仍只保存原始 envelope/payload；网络或 cache 命中均不会触发副作用，也不会把“manifest 存在但 runtime 不存在”的页面误视为可挂载。

runtime availability 是交付 compatibility 的一部分，但不能代替每次命中的 hash、signature、codec 与 remote normalize 校验。

## 7. `business-form` 垂直切片的准入规则

M5 的第一份预设是 `@domily/next/business-form` 子路径，而不是 core 根入口 API 或第二个运行时包。它必须先满足以下准入条件：

| 条件 | 含义 |
| --- | --- |
| 两个真实页面复用同一作者词汇 | 不能仅为 Todo 定制一个名称不同的组件树 |
| 配置明显缩短 | 移除重复 HTML、输入绑定或状态初始化，而不是把等量复杂度换到另一个 JSON 区块 |
| 有明确的本地实现 | manifest、runtime、renderer、capability handler 分别注册，配置中没有函数 |
| 策略可替换 | required、loading、error、empty、分页、视觉样式均由预设自身说明，未启用项目完全不受影响 |
| 可动态交付 | remote 使用需同时通过 manifest、runtime、Catalog 与 capability 的已部署权限检查 |
| 可机器验证 | 为 config schema、scope、capability args、生命周期及失败清理提供 fixture 与测试 |

首个 slice 只处理“字符串草稿表单”：extension runtime 依据 config 创建一个 page-local、readwrite 的全局唯一 `$businessForm` scope，`business.form` 是本地 Catalog/renderer。提交仍由 PageSpec 明示的 `on.submit → capability` 完成。它能验证「配置隐藏机械输入结构」而不预先决定请求、缓存或错误策略。

当前已有两份独立的 Vite 业务页面验证相同作者词汇：Todo 把表单与项目自有列表组合；Profile 只使用
原生 `html.*`、`business.form` 与 `profile.save` capability，不依赖项目自定义 renderer。两者都保留业务
capability 和 host scope，证明预设压缩的是受控输入的机械结构，而不是偷渡领域状态或工作流。

`Resource + List` 尤其是 `$item` slot scope、自动加载、刷新与异步状态，必须另立设计：当前 DOM renderer 会在 component mount 前递归物化 children/slots，尚无安全的局部 scope/重复渲染契约。不能为了演示 Todo 而把未定义的 `$item` 偷渡回 core。

## 8. 预期作者体验与诚实边界

M5 完成后，作者学习的是当前项目安装的 Catalog、extension config 和 capability contract，而不是 Domily 的通用执行语言。例如草稿表单可把多层 `label/input/button` 与手写初始化收敛为预设组件，但仍保留业务选择：

```yaml
requires:
  extensions: ["@domily/next/business-form@^1"]
  catalogs: ["@domily/next/business-form@^1"]
  capabilities: ["todos.create@^1"]
extensions:
  "@domily/next/business-form":
    drafts:
      todoCreate: { initial: { title: "" } }
ui:
  type: business.form
  props:
    fields: [{ name: title, label: 新待办, required: true }]
    submitLabel: 新增待办
  bind: { value: "$businessForm.todoCreate" }
  on:
    submit:
      capability: todos.create
      args: { title: "$businessForm.todoCreate.title" }
```

这是一个预设的示意，不是新 PageSpec 根字段；真实字段、scope 名与校验规则由该预设 contract 固定。页面若不采用它，仍可使用原始 `html.*` 与项目自己的组件。

## 9. 验收门槛

实现 M5 runtime 前必须覆盖以下情况：

- 无 runtime、ID/version 不匹配、无效 config、远程任一许可缺失，都在 DOM commit 前失败；
- runtime 不会被 delivery、cache revalidation 或 normalizer 执行；
- returned scope 的 owner/name/mode/schema、缺失/额外/重名全部拒绝；
- 两次并发 mount 绝不共享 runtime scope；activation、renderer、lifecycle、subscribe 任一失败都会清理已 activation；
- PageSpec/远程 envelope 无法提供 function、renderer、handler、URL module 或 registry mutation；
- 垂直切片确实比纯 `html.*` 示例减少作者配置，并保留 className/style 的业务控制权；
- 全部既有 native HTML、capability、delivery、cache 回归继续通过。

## 10. 后续决策

M5 草稿表单 slice 已通过两个独立业务页面验证。后续若有真实需求，再分别提出：

1. capability broker（必须单独定义可声明的 capability 权限、取消、结果与错误模型）；
2. component/slot 局部 scope 与 collection/repeat renderer contract；
3. async activation/cancellation；
4. React/Vue adapter；
5. 预设的发布形式与一包开箱体验。

在这些证据出现前，不以“全场景”之名把它们提前固化到 core。
