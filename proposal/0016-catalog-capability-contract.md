# 0016：Catalog、Capability 与 extension 的本地契约

- 状态：M1–M2 核心契约已实现；业务 extension 预设待实现
- 日期：2026-08-15
- 前置：[0015-minimal-core-and-extension-model.md](./0015-minimal-core-and-extension-model.md)
- 关联：[0013-page-spec-product-reset.md](./0013-page-spec-product-reset.md)、[0014-pagespec-authoring-model.md](./0014-pagespec-authoring-model.md)、[0004-document-delivery.md](./0004-document-delivery.md)

## 1. 决策

`Catalog`、`capability` 与 `extension` 是 Domily 的**本地宿主契约**，不是远程页面可以携带或覆盖的插件机制。

- Component Catalog 决定页面可引用哪些组件、它们的 props、slot、事件与 binding；
- Capability Catalog 决定页面可以调用哪些已注册业务能力，以及其输入、输出与远程调用权限；
- extension 为某个项目选择的高层页面模式提供 namespaced 配置和本地实现；
- PageSpec 只声明自己需要什么，不能定义新组件、执行函数、替换 handler，或下载模块。

这条边界让核心保持克制：Domily 不决定业务要用什么 UI、表单、查询、路由或状态模型；但它也不把动态化变成可执行代码分发通道。

```text
本地应用构建产物
  ├── native-html / 业务 Component Catalog 的 manifest + 实现
  ├── Capability Catalog 的 manifest + handler + 授权钩子
  └── 可选 extension 的 manifest + lowering/runtime 实现
                    ▲
                    │ 只解析、匹配、调用
                    │
本地 .dmy.* 或远程 envelope 中的 PageSpec
```

## 2. 三种注册物的职责

| 注册物 | 公开给作者、AI 与校验器的内容 | 仅留在本地宿主的内容 | 不能做什么 |
| --- | --- | --- | --- |
| Component Catalog | 标识、版本、组件类型、JSON Schema、slot、事件 payload、binding、示例 | DOM/未来 adapter 的 renderer 实现 | 不能由 PageSpec 覆盖 renderer 或新增类型 |
| Capability Catalog | ID、版本、说明、输入/输出 schema、可调用范围、示例 | handler、鉴权函数、密钥、网络/状态实现 | 不能让 PageSpec 写任意 JS/HTTP/workflow |
| extension | ID、版本、namespaced config schema、scope contract、示例 | 本地业务状态、Catalog/capability 组合与运行时实现 | 不能向 PageSpec 根节点注入未命名字段或远程加载代码 |

manifest 必须是 JSON-compatible、可随应用发布并可提供给编辑器/AI 的数据；任何函数、DOM 句柄、私有 URL、密钥、handler 或 adapter 实现都不属于 manifest。

## 3. 身份、命名空间与版本解析

每个 Catalog 与 extension 都有稳定 ID 和 SemVer 版本。例如：

```yaml
id: "@acme/todo-ui"
version: "1.3.0"
namespace: todo
```

ID 是协议身份，不等于 npm 包名；官方 Catalog 即使从 `@domily/next` 的 tree-shakable 子路径导出，也可以稳定地使用 `@domily/next/native-html` 这类 ID。这样“只安装一个主包”的发布策略与精确的协议依赖声明可以同时成立。

组件类型采用 `namespace.component`，因而页面中可以直接写：

```yaml
type: todo.TodoPage
```

`native-html` 使用 `html` namespace，所以 `html.div`、`html.input` 保持原始 HTML 的可见性与简洁性。没有任何 core 预留的 `Form`、`List`、`Page` 或 `state` namespace；项目可以使用 `app.OrderEditor`，也可以选择某个预设暴露的 `business.Form`。

版本解析规则：

1. PageSpec 的 `requires` 声明 Catalog/extension/capability ID 与兼容版本范围；作者格式可使用简写，normalizer 统一为 `{ id, range }`。
2. Host 从**已经注册的本地快照**中匹配兼容版本，不执行包下载、依赖求解或“最新版本”选择。
3. 同一 registry 中 namespace、完整组件 type、extension ID 或 capability ID 冲突时注册失败；绝不采用最后注册者覆盖前者的策略。
4. 不满足要求时，在 build 或 mount 前报出带 source location 的诊断；不得悄悄降级、替换或迁移页面。
5. 编译产物和离线缓存记录已解析的 manifest ID/版本/内容 hash；宿主升级 manifest 后，旧计划不能被误用。

Catalog 的 major version 变化表示作者契约或可观察行为存在破坏性变化。迁移由 Catalog/extension 明确提供，core 不猜测如何把旧 props、scope 或 capability 参数改成新语义。

```ts
interface Requirement {
  id: string;
  range?: string;
}
```

为了让页面简洁，codec/normalizer 可以接受 `"@domily/next/native-html@^1"` 这样的作者简写（最后一个 `@` 前为 ID、后为 range），但 normalizer 与 cache provenance 中只保存上述规范化结构。

## 4. Component Catalog manifest

Component Catalog 是组件的**声明面**，不是 UI 库的实现替身。最小 manifest 如下：

```ts
interface ComponentCatalogManifest {
  schema: 'domily.component-catalog/v1';
  id: string;
  version: string;
  namespace: string;
  description?: string;
  delivery?: { remotePage: boolean };
  components: Record<string, ComponentManifest>;
  examples?: readonly PageSpecFragment[];
}

interface ComponentManifest {
  description: string;
  props?: JsonSchema;
  slots?: Record<string, SlotManifest>;
  events?: Record<string, EventManifest>;
  bindings?: Record<string, BindingManifest>;
  styleForwarding?: {
    className?: boolean;
    style?: boolean;
  };
  examples?: readonly UiNode[];
}
```

其中：

- `props` 是该组件可接受的 JSON-compatible props schema；`additionalProperties` 默认拒绝，除非组件自己明确放宽。
- `slots` 声明名称、单/多节点与基数；M2 不接受组件/slot 局部 lexical scope。
- `events` 声明可写入 `on` 的事件名及其**净化后的 JSON payload schema**；不会暴露浏览器原生 `Event` 或 DOM 引用。
- `bindings` 声明哪些 props 可读取或双向绑定、期待的值 schema 与相应事件；实际读写由本地 scope provider 和组件实现完成。
- `styleForwarding` 只是组件对 `className`/`style` 的转发承诺。`native-html` 应直接开放两者；业务组件是否支持、如何应用，完全由业务 Catalog 决定。

组件/slot 局部 scope 需要 renderer-owned repeat、slot projection 与生命周期语义，不能只靠 manifest
声明就正确运行；早期实现因此物理拒绝该字段。它将在 M5 的可信业务 Catalog 中随完整运行时模型一并
引入，而不是提前给作者一个“能通过静态校验、却无法 mount”的假契约。

DOM renderer 注册 Catalog 时，必须同时传入与 manifest 的 type 一一对应的受信任本地实现。manifest 只用于校验、诊断与作者上下文；远程 PageSpec 永远不能把 `render`、`mount`、CSS/JS 模块 URL 等实现字段混进来。

### 4.1 Binding 是安全协议，不是内建状态库

core 只知道“从一个已注册 scope 的安全路径读/写 JSON 值”。scope provider 决定实际状态位于普通对象、信号、表单库、查询缓存还是业务组件内部；核心不拥有 `$state`、`$form` 或任何默认 store。

以原始 HTML 输入框为例：`native-html` manifest 可以声明 `value` 可绑定、`input` 事件产出 `{ value: string }`。若 Host 或某个 extension 注册了可写 `$todoDraft` scope，作者才可以写：

```yaml
type: html.input
bind:
  value: "$todoDraft.title"
```

没有该 scope 时，此页面应在校验期失败，而不是由 core 偷偷创建一份状态。

## 5. Capability Catalog manifest

capability 是配置交互的唯一副作用出口。其声明与本地实现分离：

```ts
interface CapabilityManifest {
  id: string;
  version: string;
  description: string;
  input: JsonSchema;
  output?: JsonSchema;
  invocation: {
    localPage: boolean;
    remotePage: boolean;
  };
  examples?: readonly JsonValue[];
}

interface RegisteredCapability {
  manifest: CapabilityManifest;
  authorize(context: InvocationContext, args: JsonValue): boolean | Promise<boolean>;
  invoke(context: InvocationContext, args: JsonValue): JsonValue | Promise<JsonValue>;
}
```

`authorize` 与 `invoke` 只在本地代码中运行；它们可以检查当前用户、租户、路由、来源信任等级、feature flag 或任意业务规则。`remotePage: true` 不是绕过授权，而是要求 Host 在服务端下发页面时仍允许该 capability 被引用。

PageSpec 的 `on` 或 `lifecycle` 每次只构造 JSON-compatible `args` 并调用一个 capability。一个 capability 是否更新状态、导航、刷新查询、弹通知、并行请求或执行业务工作流，均由宿主实现或业务 extension 决定。core 不增加 `then`、`catch`、`retry`、`set` 或 capability 链来代替 TypeScript。

## 6. extension contract

extension 用于将一组特定的页面政策打包为可选能力，例如 `business-page`、某个公司设计系统的表单桥接，或工作流组件。它的 config 必须被 namespaced：

```yaml
requires:
  extensions:
    - "@acme/work-order-page@^2"
extensions:
  "@acme/work-order-page":
    # 由该 extension 的 schema 独占解释
    draft: {}
```

最小 extension manifest：

```ts
interface ExtensionManifest {
  schema: 'domily.extension/v1';
  id: string;
  version: string;
  description: string;
  delivery?: { remotePage: boolean };
  config: JsonSchema;
  scopes?: readonly ScopeManifest[];
  requires?: {
    catalogs?: readonly Requirement[];
    capabilities?: readonly Requirement[];
  };
  diagnostics?: readonly DiagnosticDescriptor[];
  examples?: readonly PageSpecFragment[];
}
```

对应的业务实现只能随 Host 构建物本地注册。它可以验证自己的 config，并要求 Host 提供匹配的
scope provider 或本地 Catalog/capability；但不得改变其他 extension 的命名空间、放宽 core 的
code-execution 安全边界，或让远程文档传入函数。Catalog/extension 的 `delivery.remotePage` 和
capability 的 `invocation.remotePage` 都只是允许上限，Host 注册时仍可将其收紧为 `false`。

一个 npm 包可以同时发布 Catalog、extension 与其原生实现；这不意味着业务必须安装一串包。`@domily/next` 可以通过 tree-shakable 子路径提供官方 optional preset，项目也可以只注册自己的一个 Catalog。

`requires.extensions` 只声明版本依赖，不会单独启用 extension。页面必须同时在
`extensions[extensionId]` 提供该 extension 的配置（无字段的 extension 也写 `{}`）；
只有配置通过其 schema 以及自身依赖校验后，extension scope contract 才对该页面可见；Host（以及
remote delivery client）仍必须显式提供标注该 extension owner、且同名、同 mode/schema 的 provider。
未标注 owner 的 host scope 是主动公开给页面的普通上下文，不能替代 extension provider。这样不会把“声明了
extension”错误地等同于“创建了一份隐式业务状态”，也不会让未启用 extension 的 scope 泄漏给远程页面。

## 7. 校验、编译与运行顺序

```text
codec parse + source map
        ↓
PageSpec 基础结构 / JSON-compatible 校验
        ↓
从本地 registry 解析 requires 的 manifest 快照
        ↓
Catalog、capability、extension schema 与 host scope contract 校验
        ↓
PageSpec normalizer
        ↓
原生 DOM renderer + 本地 capability 授权/调用
```

无论来源是 `.dmy.ts`、JSON、YAML、TOON 还是 envelope，均使用同一条路径。codec 只负责文本/字节解析与来源位置，绝不能把某种格式的字段直接映射成私有执行 AST；这样才不会因未来新增 codec 而复制语义。

## 8. AI 与编辑器的作者上下文

Host 应生成一个与当前 registry 快照绑定的 `AuthoringContext`，至少包含：

- PageSpec 当前版本与可用 `requires`；
- 当前已启用 Component Catalog 的组件、props、slots、events、bindings、说明和最小示例；
- 当前页面可调用 Capability 的输入/输出 schema、远程调用限制和示例；
- 已启用 extension 的 config schema、公开 scope 与示例；
- 可机器修复的诊断代码及其源位置。

它不应包含未启用 Catalog、业务 handler 源码、密钥或整个 Domily 历史 API。AI 的正确循环是“读取当前 AuthoringContext → 生成 PageSpec → 接收 validator 诊断 → 修复”，而不是记忆一套越来越大的 DSL。

## 9. 安全与非目标

- 远程文档只能引用本地已注册、版本兼容且 `remotePage` 允许的 Catalog、extension、capability；
- extension 的 `requires.catalogs` 与 `requires.capabilities` 继承页面的来源权限；不能借由一个允许远程的 extension 间接引用 `remotePage: false` 的 Catalog 或 capability；
- manifest/registry 的信任根来自应用构建和发布流程，而不是文档 payload；
- 原始 HTML 仍由 `native-html` Catalog 以安全 DOM sink 呈现，拒绝原始 HTML 字符串、`on*`、脚本、`innerHTML`、未声明浏览器属性与未受控 DOM API；
- `className`、`style` 与 CSS 组织策略仍由业务和 Host/CSP 决定，不作为 core 的视觉政策；
- React/Vue adapter 未来只能为同一 manifest 提供实现，不能发明不同 PageSpec 语法或改变 capability 权限模型；
- Catalog 不是远程 plugin marketplace，extension 不是微型脚本语言，capability 不是任意网络请求描述语言。

## 10. 验收标准

1. 只注册 `native-html` 与项目 `app` Catalog 时，页面可以使用 `html.*`、`app.*`、直接 `className/style` 和 Host 明确提供的 scope，而无需理解 Form/List/Resource 模型。
2. 注册可选 `business-page` extension 后，其 `forms/resources/commands` 只能位于自己的 `extensions[ID]` 下，且其 `$form/$item` scope 不泄漏到未启用它的页面。
3. 同名 namespace/type/capability 的本地注册冲突、版本范围不匹配、错误 prop/slot/event/binding/scope 都在 build 或 mount 前给出来源诊断。
4. 远程 envelope 无法新增/覆盖组件实现、extension lowering 或 capability handler，也无法调用标记为 `remotePage: false` 的能力。
5. DOM host 与未来 adapter 针对同一 manifest/PageSpec 得到相同的作者层校验结果；差异只能存在于已声明的 renderer 可用性诊断中。
6. AI 只凭当前 AuthoringContext 可以生成一个通过 schema 与 manifest 校验的页面；其配置不包含执行计划、旧 AST、函数或未注册引用。
