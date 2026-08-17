# 0014：PageSpec v1 作者模型、语义组件、原始 HTML 与开放样式

- 状态：部分已由 [0015-minimal-core-and-extension-model.md](./0015-minimal-core-and-extension-model.md) 取代
- 日期：2026-08-15
- 关联：[0013-page-spec-product-reset.md](./0013-page-spec-product-reset.md)、[0005-html-component-policy.md](./0005-html-component-policy.md)、[0006-action-runtime.md](./0006-action-runtime.md)

## 1. 决策目标

PageSpec v1 是 Domily Next 面向业务开发者、AI、编辑器和服务端交付的公开页面模型。本文保留统一 UI 节点、原始 HTML、开放样式与 binding 的作者语法；其中 `Form`、`List`、`Resource`、字段校验和默认状态 UI 已由 [0015](./0015-minimal-core-and-extension-model.md) 改定为业务/预设扩展，不再是基础 PageSpec 的强制语义。

本提案确定以下作者体验：

1. **业务选择语义组件。** 项目可以注册 `Page`、`Form`、`TextField`、`Button`、`Alert`、`List`、`Checkbox` 等组件并获得相应高层体验；它们属于 Catalog/预设选择，不是基础框架规定的业务模型。
2. **原始 HTML 保留但显式命名。** `html.div`、`html.section`、`html.input`、`html.button` 等是 Component Catalog 中的受控组件，不是任意 DOM 逃生口。
3. **交互以组件事件和 capability 表达。** 作者不编写 `action.set`、`action.call`、`try`、`$ref`、临时变量或 renderer 节点；资源、表单和命令只是可选预设的更高层表达。
4. **同一语义可写为 JSON、YAML、TOON 或静态 TypeScript 对象。** 格式只改变文本表示，不能改变组件、绑定或运行时行为。
5. **复杂代码留在 capability / 自定义组件。** PageSpec 不引入任意表达式、函数、闭包、远程模块或原始 HTML 字符串；`className` 与 `style` 是公开、直接的展示属性。

## 2. 公开模型与内部模型

```text
PageSpec core                   ExecutionPlan
─────────────                   ─────────────
component / props / event  ──►  renderer nodes and safe DOM writes
binding / registered scope ──►  reference nodes and scope resolution
optional preset semantics  ──►  locally registered extension lowering
```

PageSpec 的字段、诊断代码和迁移规则是公开契约。`ExecutionPlan`、当前 `Document AST`、动作事务和 DOM 实现属于内部实现；开发者可以在调试工具中查看它们，但不依赖其结构。最小核心字段以 [0015 第 3 节](./0015-minimal-core-and-extension-model.md#3-最小-pagespec) 为准。

## 3. PageSpec 的最小顶层结构

以下是核心语义示意，正式实现需同时给出 JSON Schema 与 TypeScript 声明：

```ts
interface PageSpec {
  schema: 'domily.page/v1';
  id: string;
  requires?: CatalogRequirements;
  lifecycle?: Partial<Record<'mounted' | 'unmounted', CapabilityInvocation>>;
  ui: UiNode;
  extensions?: Record<string, JsonValue>;
}
```

| 字段 | 责任 | 不承担的责任 |
| --- | --- | --- |
| `requires` | 声明页面需要的 Component/Capability Catalog 与 extension 版本 | 不携带实现代码或远程模块 URL |
| `lifecycle` | 生命周期事件到已注册 capability 的调用 | 不成为业务工作流/脚本语言 |
| `ui` | 组件、原始 HTML、slot、binding、事件与样式 | 不承载 `innerHTML`、脚本节点、危险 DOM sink 或 `on*` 属性 |
| `extensions` | 已注册 extension 的 namespaced 配置 | 不允许远程下载或执行 extension 代码 |

`schema` 是页面模型版本；envelope 的 `codec`、`revision`、签名和缓存策略仍位于 PageSpec 外部。

## 4. 统一的 UI 节点语法

每个节点都使用同一骨架，具体可用 props、slots、bindings 和 events 由 Component Catalog 决定：

```yaml
type: html.main
props:
  title: 待办事项
children: []
slots: {}
on: {}
bind: {}
```

- `type`：catalog 中的组件标识。
- `props`：静态 JSON 值或允许绑定的位置；不存在“任意属性透传”。
- `children`：默认子节点列表。
- `slots`：具名 slot；slot 名由组件契约声明。
- `on`：事件名到已注册 capability invocation 的映射；不接受 inline action AST。
- `bind`：原始 HTML 或通用可绑定组件的双向属性绑定；其 scope 由组件/extension 注册。

`props.className` 与 `props.style` 是所有原生组件默认支持的全局展示属性；自定义组件可以在 manifest 中声明它们会被转发到哪个根节点。

业务语义组件可以把常用 binding 固化为组件 props，例如 `business.Form.props.form`、`business.TextField.props.field`、`business.List.props.source`；这完全由相应 Catalog 决定。`bind` 主要用于原始 HTML 和真正通用的受控组件。

## 5. 可选语义组件与原始 HTML 的分工

### 5.1 业务或预设提供的语义组件

`native-html` 提供 `html.text` 这类基础文本/结构节点。一个可选的 `business-page` Catalog 可以包含：

| 组件 | 作者意图 | 内建行为 |
| --- | --- | --- |
| `business.Page` | 页面骨架和标题 | 结构、标题层级和基础可访问性 |
| `business.Form` | 一个已声明 form 的编辑和提交 | 字段上下文、`submit` command、校验、pending/error 呈现 |
| `business.TextField` | form 字段输入 | label、描述、必填、value/input 同步与错误关联 |
| `business.Button` / `business.SubmitButton` | 触发 command 或 form 提交 | disabled/pending、键盘和 aria 语义 |
| `business.Alert` | 呈现明确状态或错误 | role、可访问性和 token 化样式 |
| `business.List` | 资源/数组的列表 | pending/error/empty、key 和 item scope |
| `business.Checkbox` | boolean 选择或列表项交互 | checked/change 投影与 label 关联 |
| `business.When` / `business.Each` | 有限结构性呈现 | 简单条件和有 key 的 item scope |

这些组件在原生 renderer 中可以映射为 HTML，但它们不是 core 的强制内建语义。后续 React/Vue adapter 若支持同一 Catalog，才提供相同契约的实现。

### 5.2 原始 HTML 的保留形式

原始 HTML 使用 `html.` 前缀，以避免与语义组件和业务组件冲突：

```yaml
type: html.section
props:
  aria-label: 待办区域
children:
  - type: html.h2
    children:
      - type: html.text
        props: { value: 我的待办 }
```

原始表单控件也可使用，但必须依赖某个已注册 scope 的声明式 binding 和 capability invocation，而非低层 action：

```yaml
type: html.input
props:
  type: text
  placeholder: 新待办
bind:
  value: "$todoDraft.title"
```

`html.form` 可以使用 `on.submit` 调用已注册 capability；`html.button` 可以使用 `on.click` 调用 capability。支持的标签、props 和事件由原有 HTML allowlist 演进而来，并始终拒绝：

- `script`、`<style>`、`iframe`、`innerHTML`、`srcdoc`、原始事件属性；
- 未经组件契约允许的 URL 型 DOM 属性、浏览器 API、DOM 引用和未声明属性；
- HTML 字符串插入。文本只能经 `html.text` 或受控文本 props 写入 `textContent`。

`html.*` 与业务语义组件是平等的 Catalog 选择；框架不规定哪一个必须为默认。若页面反复用相同 HTML 组合实现同一业务模式，业务可自行抽成语义组件或受控业务组件。

### 5.3 `className` 与 `style` 是业务作者的直接能力

PageSpec 不对业务作者的视觉实现施加 CSS property 白名单或 token-only 限制。原生组件和 `html.*` 均接受：

```yaml
type: html.div
props:
  className: "todo-card todo-card--urgent"
  style:
    display: grid
    gap: 12px
    background-image: "linear-gradient(#fff, #f4f4f5)"
    "--todo-accent": "#e11d48"
```

`className` 可为字符串或字符串数组；`style` 可为 CSS declaration 字符串，或键为 CSS property、值为字符串/数值/允许绑定值的对象。CSS 自定义属性、任意 property、函数值和 `url()` 都不由 PageSpec validator 过滤。其目标是让业务开发者继续使用既有 CSS、CSS Modules、Tailwind、UnoCSS、设计系统或任意样式组织方式。

配置的完整性与来源可信度由 envelope 签名、发布平台和宿主应用决定，不由样式白名单替代。样式可影响视觉、布局和外部资源请求，因此面向第三方/租户不可信配置的宿主可以自行注入 `DocumentStylePolicy` 或 CSP；该策略必须由宿主配置，页面文档不能自行提升权限。默认原生业务开发 profile 是开放的，不限制 `className` 或 `style`。

## 6. 绑定与条件

### 6.1 绑定路径

PageSpec core 只支持路径引用，统一以 `$` 开头；它不固定业务 scope 名称：

| 路径 | 可出现的位置 | 含义 |
| --- | --- | --- |
| `$event.<field>` | 事件 invocation 的 args | native renderer 投影后的安全事件数据 |
| `$<catalog-scope>.<path>` | Catalog 声明的 bindable props、slot 和 capability args | 由项目组件/extension 提供的 JSON-compatible scope |
| `$<host-scope>.<path>` | Host 显式提供的位置 | 宿主页面 props/context |

绑定只在 catalog 标为 bindable 的位置生效；其他字符串是普通文本。以 `$$` 开头表示一个字面 `$`。路径解析拒绝危险键、函数调用、索引表达式和字符串拼接。

### 6.2 条件由 Catalog 定义，而不是成为 core 表达式语言

core 不支持 `{{ JavaScript }}`、字符串拼接表达式、任意 expression AST，也不保留一个全局 `when` 节点字段。某个 Catalog/extension 若需要条件，可提供自己的 `When` 组件或受限 condition prop，并用自己的 schema 说明可用 predicate：

```yaml
type: app.When
props:
  condition:
    notEmpty: "$query.todos.error"
children:
  - type: app.Alert
    props:
      tone: error
```

一个业务预设可提供 `exists`、`empty`、`notEmpty`、`equals`、`not`、`all` 和 `any` 等 predicate；core 不内置这份列表。复杂条件、计算和领域判断应由 capability 返回明确状态，或封装进组件；新增 predicate 必须有所属 Catalog 的 schema 与跨 codec fixture。

## 7. `business-page` 可选预设示例：Resources、Forms 与 Commands

本节不是基础 PageSpec 语义。只有宿主注册并在 `requires.extensions` 声明 `business-page` 后，以下字段、scope 和组件才有效。下面的 `resources`、`forms`、`commands` 片段均是 `extensions["@domily/next/business-page"]` 内的值，不是 PageSpec 顶层字段；其 namespace 与版本规则以 [0015 第 3 节](./0015-minimal-core-and-extension-model.md#3-最小-pagespec) 为准。

### 7.1 Resource

```yaml
resources:
  todos:
    load: todos.list
    autoLoad: true
    select: items
    retry: manual
```

`load` 引用 Capability Catalog 中的只读查询能力。`select` 是从成功结果读取的静态安全路径，不是表达式。resource runtime 统一管理 `idle`、`pending`、`success`、`error` 与 retry；`List` 等语义组件默认消费这些状态。

### 7.2 Form

```yaml
forms:
  newTodo:
    fields:
      title:
        initial: ''
        required: true
        maxLength: 120
```

`Form` 与 `TextField` 负责双向同步和基础校验。字段校验仅使用 JSON Schema 风格的声明式约束；异步/领域校验必须通过 capability 或专用组件提供，不能嵌入函数。

### 7.3 Command

```yaml
commands:
  createTodo:
    invoke: todos.create
    with:
      title: "$form.newTodo.title"
    onSuccess:
      - reset: newTodo
      - reload: todos
    onFailure:
      surface: form
      form: newTodo
```

`business-page` 的 command 只可：

1. `invoke` 一个已注册、已授权且允许页面调用的 capability；
2. 对成功/失败使用有限后续操作：`reset`、`reload`、`setPageState`、`navigate`、`notify`；
3. 从声明的 `$form`、`$resource`、`$item`、`$event` 路径构造 JSON 输入。

命令没有嵌套 `try`、循环、递归、赋值脚本或动态 capability 名称。需要多步业务工作流时，将步骤收进一个可信 capability；这个预设只负责以自己的状态模型呈现结果，并不把该模型提升为 PageSpec core 语义。

## 8. 使用 `business-page` 预设的完整 Todo 示例

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
        onFailure:
          surface: form
          form: newTodo
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
    - type: html.section
      props:
        aria-label: 新建待办
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

这个页面保留了原始 `html.section`，但没有暴露手动 input 同步、loading/error 状态机、低层 action 或 AST 引用。相同 PageSpec 可以被 JSON、YAML、TOON 或 `.dmy.ts` 静态对象表示。

## 9. 本地 TypeScript 作者入口

TypeScript 不是另一门宏 DSL，而是 PageSpec 的带类型书写方式：

```ts
import { definePage } from '@domily/next';

export default definePage({
  schema: 'domily.page/v1',
  id: 'todos',
  // 与 JSON/YAML 完全相同的 PageSpec 对象
} satisfies PageSpec);
```

`definePage()` 只提供类型、冻结/开发诊断标记和 Vite 识别点；它不提供 `action()`、`ref()`、`derived()`、`event()` 等构造器。`.dmy.ts` 仍只能包含可静态解析的 JSON-compatible PageSpec，避免本地版本悄悄获得远程版本没有的运行时语义。

## 10. AI 与编辑器契约

每个 PageSpec version 必须发布：

- 顶层与当前已注册 Catalog/extension 的 JSON Schema；
- Component Catalog 与 Capability Catalog 的机器可读 manifest；
- JSON/YAML/TOON 的等价 golden fixture；
- 带 source location、错误码、修复建议的结构化诊断；
- 一个“validate / normalize / preview”的稳定工具接口。

AI 的生成流程应为“读取 catalog → 生成 PageSpec → validator 返回精确错误 → 修复”，而不是凭记忆拼装 AST。Catalog 的 description、示例、约束和版本必须成为 prompt/context 的正式输入。

## 11. MVP 验收与非目标

### 验收

1. JSON 和 YAML core PageSpec fixture 规范化为相同 ExecutionPlan；TOON 接入时复用同一断言。
2. 原生 DOM host 能渲染 `native-html` 节点，并将 lifecycle / 组件事件安全地投影为已注册 capability 调用；启用 `business-page` 后才额外验证 form、列表和资源行为。
3. `html.*` 可以写入 `className` 与 `style`，但不能写入未注册非样式属性、事件属性、原始 HTML、脚本 sink 或不安全 URL。
4. 未注册 Catalog/extension/component/capability、错误 slot、错误 binding 路径或版本不兼容均在构建期或 mount 前失败，并回链到源位置。
5. core PageSpec 不出现 `action.*`、`ref.*`、`derived.*`、`event.*`、`try/catch/finally` 或强制业务状态模型；可选 Todo 预设也不使用旧宏 DSL。

### 非目标

- 让 `html.*` 变成任意 DOM、原始 HTML 字符串或浏览器 API 的透传层；
- 通过一般脚本、函数或表达式让 PageSpec 覆盖任意业务逻辑；
- 首批就支持全部 HTML 标签、设计系统、可视化编辑器或 React/Vue adapter；
- 为每个语义组件引入一个编译器硬编码特例，或把 Form/List/Resource 固定进 core。组件行为应由 Catalog 的统一描述和可扩展 adapter 完成。

## 12. 对现有实现的迁移含义

- 现有 `view.page/form/textField/list/checkbox` helper 的体验目标可由 `business-page` 或业务 Catalog 承接，但作者不再导入 helper；core 只保留 `native-html` 与结构能力。
- 现有 HTML 白名单与安全 DOM writer 成为 `html.*` Catalog 的实现基础；其中针对 `style`、`className` 与 CSS 变量的拒绝规则由本提案取代，其他代码执行型安全拒绝规则继续有效。
- 现有 action/runtime 可作为 PageCompiler 的过渡后端；若业务启用 resource/form 预设，其可见生命周期由预设定义而非 core 强制。
- `@domily/next/author`、旧 `.dmy.ts` compiler 和宏 DSL 已删除；`.dmy.ts` 只表示普通 TypeScript 的 `definePage({ ... })` 对象。
