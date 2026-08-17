# 0015：最小核心、Catalog 与可选预设

- 状态：M1 部分已实现
- 日期：2026-08-15
- 取代：[0014-pagespec-authoring-model.md](./0014-pagespec-authoring-model.md) 中将 `Form`、`List`、`Resource`、字段校验与默认状态 UI 定义为 PageSpec 核心语义的部分
- 关联：[0013-page-spec-product-reset.md](./0013-page-spec-product-reset.md)、[0012-package-boundaries.md](./0012-package-boundaries.md)

## 1. 决策

Domily Next 是基础配置运行时，不是固定的低代码业务页面产品。核心只提供“让一份可序列化页面配置能够被加载、验证、渲染、绑定并触发已注册能力”的机制；页面应该长成什么样、表单如何校验、列表如何加载、错误如何展示、样式如何组织，均由业务的 Component Catalog、Capability Catalog 和可选预设决定。

```text
Domily core
  ├── PageSpec 基础语法与版本
  ├── 组件树、slot、props、事件投影与安全 binding
  ├── Catalog / capability 注册与诊断接口
  ├── native DOM renderer 与 native-html Catalog
  └── codec、source map、envelope、缓存抽象

业务 / 可选预设
  ├── 基础 UI：Button、Stack、Alert、Dialog …
  ├── 业务页面：Form、Field、Resource、List、Table …
  ├── 状态模型、校验、查询缓存、导航、通知 …
  └── 业务组件与 capability
```

这让 Domily 成为业务的辅助者，而不是替业务选择 UI 库、表单库、请求模型、错误模型或设计系统的代理人。

## 2. 核心必须做什么

| 核心机制 | 说明 |
| --- | --- |
| 文档身份与格式 | `schema`、`id`、JSON-compatible 限制、codec、source map、版本迁移与诊断 |
| UI 组合 | `type`、`props`、`children`、`slots`、component manifest |
| 原生渲染 | 原生 JS/TS + DOM host，内置 `native-html` Catalog，以及受控文本/结构节点 |
| Binding | 安全路径、显式 scope、事件 payload 投影；不执行字符串 JavaScript |
| 交互出口 | 组件事件/生命周期到宿主已注册 capability 的调用与授权钩子 |
| 动态交付 | envelope、hash/签名验证注入点、缓存、离线回退与已部署 Catalog 版本检查 |
| 开放样式 | `className` 与 `style` 原样交给业务；来源信任/CSP 由宿主决定 |

core 不定义 `Form`、`Resource`、`List`、`Table`、请求重试、加载/错误/空态 UI、校验规则、路由、通知、全局状态或设计 token。

## 3. 最小 PageSpec

基础 PageSpec 只包含页面身份、它要求宿主预先提供的能力，以及一个 UI 根节点。生命周期是可选的通用事件出口，而不是业务工作流语言。

```ts
interface PageSpec {
  schema: 'domily.page/v1';
  id: string;
  requires?: {
    catalogs?: readonly string[];
    capabilities?: readonly string[];
    extensions?: readonly string[];
  };
  lifecycle?: Partial<Record<'mounted' | 'unmounted', CapabilityInvocation>>;
  ui: UiNode;
  extensions?: Record<string, JsonValue>;
}

interface UiNode {
  type: string;
  props?: Record<string, JsonValue | Binding>;
  bind?: Record<string, Binding>;
  on?: Record<string, CapabilityInvocation>;
  children?: readonly UiNode[];
  slots?: Record<string, UiNode | readonly UiNode[]>;
}

interface CapabilityInvocation {
  capability: string;
  args?: JsonTemplate;
}
```

该骨架故意没有 `state`、`resources`、`forms`、`commands` 或 `actions`。它们不是每个页面都需要、也不是基础框架应替业务固定的模型。

`requires.catalogs` 与 `requires.extensions` 使用带版本要求的已部署标识；core 只核对宿主已注册的实现是否兼容，不下载、解析或选择 npm 依赖。`extensions` 的 key 使用不带版本范围的稳定 extension ID，值完全由该 extension 的 schema 所有。例如：

```yaml
requires:
  extensions:
    - "@domily/next/business-page@^1"
extensions:
  "@domily/next/business-page":
    # 仅由该 extension 解释的 JSON-compatible 配置
    forms: {}
```

因此 extension 不能悄悄向 PageSpec 根节点添加通用字段，也不会与另一个业务 extension 争抢 `forms`、`state` 之类的名称。

`CapabilityInvocation` 每次只允许调用一个宿主已注册并授权的 capability；它不是内嵌函数、任意 HTTP 请求或可远程加载的代码。复杂编排、并发、重试、状态更新和领域错误处理应由 capability、组件或已启用的 extension 实现，而不是由 core 把多个 invocation 串成工作流语言。

## 4. Scope 与 binding：机制而非命名空间政策

核心定义安全路径语法和 scope 注册机制，但不规定所有页面必须拥有 `$form`、`$resource`、`$state` 或 `$item`。

```text
$<scope>.<safe-path>
```

- native renderer 提供经过净化的 `$event` scope；
- 已启用 extension 可声明所需的 scope contract，例如 `$todo`、`$form`、`$query`；在原生 DOM M5 中，这类 scope 只能由该 extension 的可信 runtime 在每次挂载时创建，普通 host scope 不得以同名“履约”；
- Host 可显式提供页面 props/context scope；
- core 只检查名称、路径和 JSON-compatible 值，不猜测这些 scope 的业务含义。

M2 不把组件/slot 局部 lexical scope 暴露为一个未实现的静态字段；这类需要 repeat/slot runtime
语义的能力将随 M5 business Catalog 一并引入。AI 与开发者只需学习当前 Host/extension 明确提供的
scope，而不是预先学习一套 Domily 业务世界观。

extension runtime 的具体挂载、隔离和清理协议以后续 [0020](./0020-trusted-extension-runtime-and-preset-admission.md) 为准；本节不授权静态 host scope 替代 extension-owned scope。

## 5. Catalog 是扩展中心

Catalog 同时描述可写配置与原生实现：

```text
Component Catalog
├── id / version / description / examples
├── component names
├── props、slots、events、bindable props
├── className/style 转发约定
├── native renderer implementation
└── JSON Schema / TypeScript type metadata
```

core 只验证“页面是否引用已注册且版本兼容的组件，以及是否符合其 manifest”。它不关心组件叫 `Form` 还是 `OrderEditor`，也不关心一个 `List` 是否具有分页、虚拟滚动、错误态或选择态。

`native-html` 是首个随原生 host 提供的 Catalog：它将 `html.div`、`html.button`、`html.input`、`html.text`、`html.fragment` 等映射到 DOM，并直接开放 `className` 与 `style`。必要结构节点属于同一渲染基础能力，而不是业务组件库。

## 6. Capability Catalog 与交互

Capability Catalog 声明业务可调用能力、输入/输出 schema、描述、远程可调用权限和授权钩子。PageSpec 只能从 `on` 或 `lifecycle` 引用它。

```yaml
ui:
  type: html.button
  props:
    className: todo-create
  on:
    click:
      capability: todos.create
      args:
        title: "$todoDraft.title"
```

这条机制不规定点击后应该刷新什么列表、关闭什么弹窗或显示什么通知。业务可以在 capability 内完成复杂工作、选择已注册的 state/query/form/workflow extension，或用自定义组件封装完整交互。

core 不发展 `try`、`if`、循环、链式 `then`、`reset/reload/notify` 等通用工作流语言；否则会再次退化为难学的、半套 JavaScript 的 AST DSL。

## 7. 预设和 extension 是可选的

为了让常见业务场景保持高效，可提供但不强制启用以下 Catalog/extension：

| 可选项 | 可提供的能力 | 不进入 core 的原因 |
| --- | --- | --- |
| `native-html` | 原始 HTML、DOM 事件、开放 `className/style` | 原生 host 的最小渲染 catalog，不定义业务页面策略 |
| `basic-ui` | Button、Stack、Alert、Dialog 等通用 UI | 不同业务可已有不同设计系统 |
| `state` | 页面局部 state、state binding、简单 patch | 不同应用的状态模型不同 |
| `business-page` | Form、Field、Resource、List、基础校验和状态 UI | 是一套产品偏好，不应强加给所有项目 |
| `navigation` / `notification` | 路由、消息、确认弹窗 | 强依赖宿主应用架构 |
| `delivery` | 远程 envelope、签名、缓存、离线策略 | 本地静态页面不必承担此复杂度 |

它们可以由 `@domily/next` 的 tree-shakable 子路径或独立业务包发布；“只安装一个主包”和“不将不使用的代码带入浏览器”并不矛盾。关键不在 npm 包数量，而在业务页面是否被迫理解并启用它们。

extension 只能由本地宿主注册，远程文档只能引用其已部署的 ID/版本，绝不能通过配置下载或执行新的 extension 代码。

## 8. 如何仍然获得低心智与 AI 友好

低心智不来自框架预装所有业务语义，而来自 **当前配置可见的内容足够少且足够准确**：

1. 开发者先选择/注册本项目需要的 Catalog 与 extension；
2. 编辑器和 AI 只读取这些 Catalog 的 schema、示例、scope 与 capability contract；
3. PageSpec validator 只针对当前 `requires` 提供精确诊断；
4. 复杂场景封装成项目组件或 extension 后，页面配置仍保持短小。

同一个 Todo 可以有两种同样合法的写法：

- 纯 `native-html` + 项目自定义 `app.TodoPage`，由业务自己掌控交互和状态；
- 启用 `business-page` 预设，以 `Form/List/Resource` 获得高层简写。

两者共享 codec、PageSpec、Catalog、capability、安全交付和 native renderer，但不共享被强加的业务政策。

## 9. 迁移与验收

1. 删除旧 AST、action runtime 与 DOM renderer，不为已废弃的作者 DSL 保留 private execution kernel。
2. 先实现最小 PageSpec、`native-html` Catalog、Catalog/Capability manifest、binding/scope 注册与 `on`/`lifecycle → capability` 通道。
3. 用纯 HTML + 自定义 Todo 组件证明 core 不要求 Form/List/Resource 模型。
4. 再以独立可选的 `business-page` 预设重写同一 Todo，验证高层体验不会污染 core。
5. 最后接入 JSON/YAML/TOON codec、envelope、缓存与离线示例，验证远程文档只能组合本地已注册 Catalog/extension/capability。

MVP 验收：

- 仅启用 `native-html` 的页面不包含或依赖 `Form`、`Resource`、`List`、`state` 等业务预设；
- 任意业务 Catalog 可定义组件、props、slot、事件和开放样式；需要局部 scope 的业务 Catalog 必须同时提供完整的可信 runtime，而不改 core；
- 未注册 Catalog、extension、component 或 capability 的远程文档在 mount 前失败；
- AI 根据实际 Catalog/Capability manifest 能生成通过校验的页面配置；
- CSS 仍由业务直接控制，核心只阻止函数、DOM 引用、原始 HTML 注入和未注册能力调用。

## 10. 对既有草案的影响

- [0013](./0013-page-spec-product-reset.md) 中 `resources/forms/commands` 的示例应理解为可选 `business-page` 预设，不再是核心 PageSpec 树。
- [0014](./0014-pagespec-authoring-model.md) 保留统一 UI 节点、开放样式、原始 HTML 和 binding 安全边界；其中“原生 v1 内置语义组件”和“顶层 Resource/Form/Command”改为可选预设示例。
- [0005](./0005-html-component-policy.md) 的 HTML 安全边界继续作为 `native-html` Catalog 的实现基础；开放样式策略保持不变。
- [0012](./0012-package-boundaries.md) 的单向依赖原则保持不变；未来 adapter/preset 只单向依赖 core，core 不反向依赖业务包。
