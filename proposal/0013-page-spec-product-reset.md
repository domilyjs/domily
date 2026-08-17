# 0013：从执行 AST 回到业务页面配置

> 实施更新（2026-08-15）：本文中关于“过渡期复用/保留旧 AST、runtime、author compiler”的
> 讨论已经失效。`domily-next` 尚未发布，相关源码已直接删除；当前实现以
> [0018](./0018-pagespec-migration-and-mvp-plan.md) 为准。

- 状态：决策已实施；历史迁移讨论已被 0018 收口
- 日期：2026-08-15
- 关联：[0001-schema-driven-ui.md](./0001-schema-driven-ui.md)、[0002-document-codecs.md](./0002-document-codecs.md)、[0003-authoring-dsl.md](./0003-authoring-dsl.md)、[0004-document-delivery.md](./0004-document-delivery.md)、[0012-package-boundaries.md](./0012-package-boundaries.md)

## 1. 重新定义要解决的问题

Domily Next 不应成为又一个 React、Vue、Angular、Solid 或 Svelte 的替代品，也不应要求业务开发者学习一个可序列化的汇编语言。

它要提供的是一个 **受可信组件与能力目录约束的业务页面配置层**：

- 业务开发者以当前项目 Catalog 已提供的页面、表单、字段、资源、列表和提交意图搭建标准业务页面；未选择这些预设的项目可以只使用原始 HTML 与自己的组件；
- AI 基于同一份组件/能力目录生成、修复和验证页面配置；
- 服务端可安全地下发已部署组件和能力的组合，以更新文案、布局、字段和有限工作流；
- 复杂业务规则、算法、认证、网络协议和新的交互组件仍由普通代码实现。

这不是放弃“配置驱动”，而是明确：**配置驱动的是页面组合和受限业务编排，不是任意程序。**

## 2. 当前方向为什么没有达到目标

当前 `.dmy.ts` Todo 示例只有加载、新增和勾选三种交互，却需要作者理解 `state`、`derived`、`actions`、`lifecycle`、`view`、`ref`、`event`、`cap` 等概念；见 [示例](../examples/domily-next-vite-todo/src/todo.dmy.ts)。

这不是某一个 helper 缺失造成的，而是架构结果：

1. 当时的 `@domily/next/author` 暴露的 `action`、`derived`、`event`、`ref` 和 `view` 本质上是执行 AST 的逐项构造器；该实现已删除。
2. 当前提案明确要求 DSL 与 AST 一一对应；见 [0003 的第 6 节](./0003-authoring-dsl.md#6-ast-生成示例)。宏只是把 `kind`、`$ref` 和 `op` 换成函数名，并没有减少作者需要理解的运行时模型。
3. `try/catch/finally`、临时变量、手动 loading/error、input 事件到 state 的同步，是运行时实现细节，不应成为“创建一个表单和列表”的日常工作。
4. 通用 HTML 白名单是重要的安全底座，但不是业务开发者和 AI 的产品模型。真正可配置、可复用的单位应是带契约的 `Page`、`Form`、`TextField`、`List`、`Table`、`Detail` 等语义组件。

因此，原有的安全边界和执行内核仍有价值；错误的是把它们当成作者界面。

## 3. 产品原则

1. **作者优先，IR 隐藏。** 作者只学习当前项目已注册的组件、capability、scope 和极小的 binding 语法；AST 只用于编译、调试、缓存和执行。
2. **配置表达意图，不表达机械步骤。** 若业务选择了表单/资源预设，“提交表单后刷新列表”可以是该预设的配置语义；`set → call → assign → set → finally` 永远只是其内部实现的职责。
3. **机制优先，不替业务定政策。** Core 定义组件组合、Catalog、binding、事件到 capability 的通道和交付边界；`Form`、`Resource`、`List`、状态模型、错误 UI、请求策略和设计系统均为业务或可选预设的选择。
4. **组件目录是扩展中心，HTML 是原生底座。** 页面配置只引用宿主已注册的 Catalog；原始 HTML 以显式 `html.*` Catalog 保留给布局和高级场景。`className` 与 `style` 对业务作者直接开放，核心只阻止代码执行型危险 sink。
5. **多格式共享语义，不共享痛苦。** JSON、YAML、TOON、TOML、BSON 是同一个公开页面模型的不同编码，不能各自携带不同运行时语义。格式支持按需求分批，不以“所有格式齐全”阻塞体验验证。
6. **动态化只能组合已部署能力。** 服务端不能通过配置注入任意 JavaScript、DOM API 或新组件代码；它只能引用宿主已注册且被授权的 Catalog、extension 和 capability。
7. **AI 必须基于契约工作。** 组件、能力、scope、extension 和错误诊断必须机器可读，否则“AI 友好”没有可验证的基础。

## 4. 新的三层模型

```text
开发者 / AI / 配置平台
  PageSpec Source Document
  (.dmy.ts / .dmy.json / .dmy.yaml / .dmy.toon ...)
                  │
                  ▼
    schema + catalog validation + Page compiler
                  │
                  ▼
      Executable Document / ExecutionPlan
      （私有 IR；可复用现有 AST/runtime）
                  │
                  ▼
  host renderer + 已注册 Component / Capability
```

### 4.1 PageSpec 是公开契约

`PageSpec` 是开发者、AI、编辑器和发布平台读写的唯一语义模型。它必须是 JSON-compatible，具备公开版本、JSON Schema、类型声明、迁移器与稳定诊断。

基础 `PageSpec` 只包含通用组合概念。`resources`、`forms`、`commands`、`state`、导航和通知等高层概念由业务或可选 extension 按需提供，不能被误写为所有页面必须学习的顶层模型。详见 [0015](./0015-minimal-core-and-extension-model.md)。

```text
PageSpec
├── id / version / requires       # 身份、协议与已部署 Catalog/extension 依赖
├── lifecycle                     # 通用生命周期事件 → 已注册 capability
├── ui                             # component tree、slot、props、binding 与事件 → capability
└── extensions                     # 显式启用的、由宿主注册的 namespaced 扩展配置
```

它不是当前 `Document AST` 的别名，也不要求作者手写 `reference`、`expression`、`set`、`call`、`try` 或 renderer 节点。

### 4.2 ExecutionPlan 是私有执行格式

`PageCompiler` 将通过校验的 PageSpec 降级为 `ExecutionPlan`。在过渡期，它可以以现有 `Document` AST 为后端；runtime 的事务、受限 expression、capability 授权、trace、envelope、缓存和 renderer 安全防线可复用。

这允许我们先替换错误的作者面，而不是立即重写所有正确的底层代码。`ExecutionPlan` 不承诺作为业务作者格式，也不允许被某个 codec 的细节反向定义。

若业务启用 `resource` 或 `form` 预设，它们不能只是旧 action 事务的语法糖：预设必须自行定义可观察的 `idle / pending / success / error` 生命周期，使 loading、错误和重试能在正确的时间显示。现有 runtime 的整体 action 事务语义可保留给低层执行安全；core 不把这套业务状态模型强加给未启用预设的页面。

### 4.3 原生 JavaScript/TypeScript 是第一个正式宿主

首个生产目标是浏览器原生 JavaScript/TypeScript：业务应用可直接使用 `createDomilyApp()`、原生 DOM 和 Domily 的 Catalog，不依赖 React、Vue 或其他框架。当前 DOM renderer 不再只作为测试参考，而是 PageSpec v1 的首个正式 renderer；它需要围绕 Catalog、增量状态呈现、可访问性和稳定事件投影演进。

这不等于再造一个通用前端框架。原生宿主只负责将 PageSpec 的受控组件投影到 DOM、提供 binding/scope/事件投影并调用 capability；页面局部或全局状态、命令编排、路由和业务组件模型由 Host 或 extension 选择。它不试图接管业务应用的 JavaScript 编程模型。

未来的 React/Vue adapter 必须消费相同的 PageSpec、Component Catalog、Capability Catalog 与 ExecutionPlan，不能引入另一套作者语义。它们是可选生态适配包，不是核心或首个 MVP 的前提。

### 4.4 三种复杂度各归其位

```text
通用配置组合与事件出口 →  PageSpec core 的 component / binding / capability 机制
重复的业务页面模式   →  业务 Catalog 或可选 Form/Resource/List 等预设
复杂业务规则与副作用 →  宿主 capability、后端和普通 TypeScript
新的视觉或交互能力   →  已部署的受控组件及其 manifest
```

“全场景”应指上述三层能够组合，而不是承诺纯配置覆盖任意算法。

## 5. 可选业务预设的作者体验：表单 + 列表不应暴露执行细节

下面是 `business-page` Catalog/extension 可提供的 YAML 示意；它不是 core PageSpec 的强制形态。选择该预设的业务可获得 Form/List 简写，未选择的业务可只使用 `native-html` 与自己的组件。

```yaml
schema: domily.page/v1
id: todos

requires:
  catalogs:
    - "@domily/next/native-html@^1"
    - "@domily/next/business-page@^1"
  extensions:
    - "@domily/next/business-page@^1"
  capabilities:
    - todos.list
    - todos.create
    - todos.toggle

extensions:
  "@domily/next/business-page":
    resources:
      todos:
        load: todos.list
        autoLoad: true
        select: items

    forms:
      newTodo:
        fields:
          title:
            initial: ""
            required: true

    commands:
      createTodo:
        invoke: todos.create
        with:
          title: "$form.newTodo.title"
        onSuccess:
          - reset: newTodo
          - reload: todos
      toggleTodo:
        invoke: todos.toggle
        with:
          id: "$item.id"
          completed: "$event.checked"
        onSuccess:
          - reload: todos

ui:
  type: business.Page
  props:
    title: 待办事项
  children:
    - type: business.Form
      props:
        form: newTodo
        submit: createTodo
        submitLabel: 新增待办
      children:
        - type: business.TextField
          props:
            field: title
            label: 新待办
            placeholder: 例如：阅读协议草案
    - type: business.List
      props:
        source: todos
        key: id
      slots:
        item:
          type: business.Checkbox
          props:
            label: "$item.title"
            checked: "$item.completed"
            command: toggleTodo
```

该示例刻意不出现：

- `try/catch/finally`、临时 response 变量和手动 loading/error state；
- `ref.state()`、`ref.item()`、`derived.empty()`、`event.value()`；
- 手动 input 事件到表单 state 的同步；
- `action.call()` 或 HTML 节点细节。

`$form.*`、`$item.*`、`$event.*` 是这个预设注册的 scope，而不是 core 的全局命名空间。binding 只允许路径读取，不能嵌入 JavaScript 或表达式；其他业务只会看到它们实际启用的 Catalog/extension 提供的 scope。

`Form`、`TextField`、`List` 等组件可以负责其约定的 loading、错误、字段同步、必填校验和默认交互；这是该预设的策略，不是基础框架替所有业务作出的决定。

## 6. Component Catalog 与 Capability Catalog

### 6.1 Component Catalog

每个宿主注册的组件都要同时提供：

- 实际 renderer 实现；
- 机器可读 manifest：名称、版本、props、slots、可绑定字段、事件、可用 token、可访问性约束和 JSON Schema；
- 可选的页面模式能力，例如 `Form` 的 `form`、`TextField` 的 `field`、`List` 的 `source`。

组件 manifest 是 PageSpec validator、编辑器补全与 AI 提示的共同事实来源。配置中的 `type` 只能引用 catalog 内的组件，且 `requires` 需声明兼容版本。

### 6.2 Capability Catalog

capability 除执行函数外还需可选的公开描述：名称、输入/输出 schema、是否允许远程页面调用、授权策略标识和稳定错误模型。core 的 `on`/`lifecycle`，以及业务 extension 的 `invoke`，都只能引用宿主允许的 capability。

业务端仍用普通 TypeScript 实现 API、认证、算法与领域规则；配置只传递经过 schema 校验的 JSON 输入并消费公开结果。这样既不让页面配置退化成后端工作流，也能让 AI 知道可用的业务动作。

## 7. 格式、本地开发与动态交付

### 7.1 格式不是作者语言

codec 的职责调整为：将 JSON、YAML、TOON、TOML 或 BSON 解码为 `PageSpec` 的原始 JSON-compatible 值，并保留 parse 阶段分配的 source node ID/位置。`PageCompiler` 是唯一把公开 PageSpec 规范化为 ExecutionPlan 的地方。

建议优先级：

1. `.dmy.json`：服务端交付与基准 fixture；
2. `.dmy.yaml`：人工阅读/编辑的首个非 JSON 格式；
3. `.dmy.toon`：experimental，作为 AI token 效率格式，但不能先于 schema/fixture 稳定；
4. `.dmy.ts`：可选的静态、带类型作者入口，只接受一个普通的 `definePage({ ... })` 静态对象，不再要求一组 compiler-only 宏；
5. TOML、BSON：按真实存储/传输需求追加，不承诺其适合深层组件树的人类作者体验。

### 7.2 本地与远程走同一编译管线

```text
local .dmy.*  ─┐
                ├─ codec/static loader → PageSpec validation → PageCompiler → ExecutionPlan
remote envelope ─┘                                                        │
                                                                           ▼
                                                                        mount
```

Vite 的职责是加载、编译、诊断和 HMR，不是定义新的语言语义。`.dmy.ts`、`.dmy.json`、`.dmy.yaml` 与 `.dmy.toon` 的差别仅在输入 codec/loader，不应产生不同的页面行为。

原生 JavaScript/TypeScript 应保持最小安装面：`@domily/next` 继续提供默认的原生 DOM host 与 `createDomilyApp()`；`@domily/next-vite-plugin` 仍是独立开发依赖，具体 codec 仍为按需安装的独立包。未来 `@domily/next-react`、`@domily/next-vue` 也必须是单向依赖 core 的可选适配包，不能反向进入原生运行时。

### 7.3 保留 envelope 与离线策略

[0004](./0004-document-delivery.md) 的 envelope、revision、content hash、签名验证注入点、原始 payload 缓存和离线优先策略继续有效，但 payload 由旧 AST 改为 PageSpec source。客户端缓存：

1. 经验证的原始 payload 与 codec/source map；
2. 由该 revision、PageSpec version 与 host catalog version 得到的 ExecutionPlan；
3. 最后一个可用版本，确保新的无效配置不会覆盖离线可用页面。

服务端热更新可以更新页面组合、文案、已启用 extension 所定义的字段/资源参数和已注册 capability 的组合；新组件代码、浏览器权限或任意逻辑仍要求客户端发布。

## 8. 不做的事

- 不把 JSON/YAML/TOON 当成运行任意函数的容器；
- 不重新实现 React/Vue/Svelte 的通用组件模型、路由、状态管理或渲染器生态；
- 不以通用 `if`、`while`、表达式 AST、闭包或远程模块来承诺“配置覆盖一切”；
- 不在首个重构版本支持原始 HTML 字符串、富文本、文件上传、图表、拖放、SSR 或所有 codec；
- 不因作者层重构丢弃 capability 信任边界、文档签名/缓存或 validator 的安全要求。

## 9. 重构策略

不建议现在完整推倒 `domily-next` 或另起一个无法验证的实现。建议在当前 Next 内采取并行迁移：

1. **冻结旧作者面。** 将现有 `.dmy.ts` 宏 DSL 与直接 AST JSON 标记为 experimental legacy，停止添加新的 `action/ref/derived/view` helper。
2. **先冻结 PageSpec v1。** 编写公开 schema、绑定规则、Component/Capability Catalog 契约、诊断代码和 JSON/YAML 同构 fixture；先不连接 renderer。
3. **实现 PageCompiler。** `PageSpec → ExecutionPlan` 优先复用现有 runtime AST，形成单一 normalizer；旧 json codec 不再自行承担 AST 语义映射。
4. **以两个 Todo 验证体验。** 先用 `native-html` + 项目组件证明 core 不强加状态/表单/列表模型；再用可选 `business-page` 预设证明高层简写不泄漏到 core。两者均不得导入旧 `action/ref/derived/event/cap` 宏。
5. **补齐目录和 AI 反馈回路。** 为最小组件和 capability 输出 manifest/JSON Schema，提供可机器读取的诊断、fixture、预览和“配置 → 编译结果”查看能力。
6. **迁移而非静默兼容。** PageSpec 通过稳定协议版本与显式迁移器演进；旧 AST 仅作为内部后端和可控的迁移源，待新示例验证后再决定是否删除旧 author/compiler API。

## 10. 第一阶段可验证的成功标准

1. 同一 Todo PageSpec 可以从 JSON 与 YAML 得到语义相同的 ExecutionPlan；TOON 接入前也必须通过同一 fixture 套件。
2. 本地和远程示例使用同一份 PageSpec 语义，均经 Component/Capability Catalog 校验；远程版仍保存原 payload 并能离线回退。
3. `native-html` 示例不依赖 `Form/Resource/List/state` 预设；选择 `business-page` 的表单 + 列表示例不出现 AST 节点、旧 `action.*`/`ref.*`/`derived.*`/`event.*` 宏或手动 `try/catch/finally`。
4. 未注册组件、未声明 capability、错误绑定路径、非法事件和不兼容 catalog 版本能在构建期或 mount 前给出带 source location 的确定性诊断。
5. AI 只需获得 PageSpec schema、当前 catalogs 和目标描述，即可生成一个通过 validator 的基础页面；不以“能写出复杂 AST”作为成功标准。
6. 页面配置无法引入任意 JavaScript、原始 HTML 字符串、危险 DOM sink、浏览器 API 或未部署组件代码；`className` 与 `style` 是显式允许的业务展示能力。

## 11. 已确认与仍需由产品方向确认的决定

1. **已确认：首个生产 renderer 宿主是原生 JavaScript/TypeScript + DOM。** `@domily/next` 的原生 host 是首要实现，不以 React/Vue 为前提；React/Vue 仅在原生语义和 Component Catalog 稳定后以可选 adapter 接入。
2. **已确认：原始 HTML、`className` 与 `style` 保留；语义组件由业务选择。** 原生 core 提供 `native-html` 与必要结构节点；`Page`、`Form`、`TextField`、`Button`、`Alert`、`List`、`Checkbox` 等由业务 Catalog 或可选预设提供。业务配置可直接写 `className` 和 `style`，但仍不能携带原始 HTML、`on*` 属性、脚本节点或未声明浏览器 API。
3. **远程下发的发布形态。** 默认建议交付可读 PageSpec source、客户端编译并缓存 ExecutionPlan；若以后需要性能优化，再增加经过同版本 compiler 生成的预编译 plan，而不改变公开 source 合约。

## 12. 本提案对既有提案的影响

- [0001](./0001-schema-driven-ui.md) 的产品目标、安全边界、capability、离线与多格式原则仍成立；“codec 直接得到 Document AST”需要由“codec 得到 PageSpec，compiler 得到内部 ExecutionPlan”取代。
- [0002](./0002-document-codecs.md) 的 codec 扩展边界、source map 与跨格式等价测试仍成立，但其输入/输出模型需要迁移到 PageSpec。
- [0003](./0003-authoring-dsl.md) 的宏 DSL 不再是默认作者体验；其 compiler 和 AST 可以成为迁移期实现资产。
- [0004](./0004-document-delivery.md) 的 envelope/cache 职责不变，payload 语义更新为 PageSpec source。
- [0005](./0005-html-component-policy.md) 至 [0008](./0008-dom-host-composition.md) 的安全与执行边界保留，但应位于 Component Catalog/renderer 后方，而不是定义作者日常 API。
- [0009](./0009-vite-authoring-integration.md) 的 Vite 包边界保留，转换目标由宏 DSL 改为统一的 PageSpec 编译。
- [0012](./0012-package-boundaries.md) 的 core/codec/Vite 单向依赖仍成立；具体公共 API 将在 PageSpec 迁移提案确认后调整。
