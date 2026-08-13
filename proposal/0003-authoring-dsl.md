# 0003：作者 DSL、受限宏与 Document AST 编译

- 状态：核心作者规则已确认，待细化 API
- 日期：2026-08-12
- 关联：[0001-schema-driven-ui.md](./0001-schema-driven-ui.md)、[0002-document-codecs.md](./0002-document-codecs.md)

## 1. 决策

`Document AST` 是机器可验证、可序列化、可下发的 IR，不是开发者的默认作者界面。开发者应编写接近普通 TypeScript 的受限 DSL；AI 可以生成该 DSL 或直接生成 JSON AST。构建期 compiler 将 DSL 转换为完全等价的 `Document AST`，服务端和浏览器只执行 AST。

这解决两个不同需求：

- **本地开发者体验**：有类型提示、重构、跳转、测试和接近业务意图的写法；
- **AI/服务端交付**：有封闭 schema、可校验、无任意 JavaScript 的 AST 文档。

## 2. 分层与禁止项

```text
作者 TypeScript DSL (.domily.ts)         AI / 服务端文档 (.domily.json)
            │                                      │
            ▼                                      ▼
      build-time compiler                       codec + validator
            │                                      │
            └──────────────► Document AST ◄────────┘
                                      │
                                      ▼
                                   runtime
```

- DSL 宏只在构建期执行；它们不能作为服务端下发的“函数”或 browser runtime API。
- compiler 必须输出不含函数、闭包、import、`eval` 或任意 JS 源码的 AST。
- runtime 不加载 `.domily.ts`，也不执行来自文档的 JS。
- AST 永远可以被 JSON codec 序列化；作者 DSL 不需要也不应被序列化。

## 3. 第一种作者语言：受限 TypeScript 宏 DSL

MVP 推荐 TypeScript DSL，而不是另造文本语法。它利用编辑器、类型系统和现有构建工具，并以显式宏调用保持 AI 可生成性。

开发者示例：

```ts
import { defineDocument, state, derived, action, view, ref, event, cap } from "@domily/next";

export default defineDocument({
  id: "todo-list",
  state: state({
    newTitle: "",
    todos: [],
    loading: false,
    error: null,
  }),
  derived: {
    canSubmit: derived.not(derived.empty(ref.state("newTitle"))),
  },
  actions: {
    loadTodos: action.try(
      [
        action.set("loading", true),
        action.call(cap("todos.list"), { assign: "response" }),
        action.set("todos", ref.var("response.items")),
        action.set("error", null),
      ],
      {
        catch: [action.set("error", ref.error("message"))],
        finally: [action.set("loading", false)],
      },
    ),
    createTodo: [
      action.call(cap("todos.create"), {
        args: { title: ref.state("newTitle") },
      }),
      action.set("newTitle", ""),
      action.run("loadTodos"),
    ],
  },
  lifecycle: {
    mounted: action.run("loadTodos"),
  },
  view: view.stack({ gap: "md" }, [
    view.textField({
      label: "待办事项",
      value: ref.state("newTitle"),
      onInput: action.set("newTitle", event.value()),
    }),
    view.button({
      label: "新增",
      disabled: derived.not(ref.derived("canSubmit")),
      onClick: action.run("createTodo"),
    }),
    view.when(ref.state("error"), view.alert({ tone: "danger", message: ref.state("error") })),
    view.repeat({
      each: "todo",
      in: ref.state("todos"),
      key: ref.item("todo", "id"),
      template: view.text({ value: ref.item("todo", "title") }),
    }),
  ]),
});
```

这仍然是 AST 的精确表达，却把 `{ "op": "…" }`、`$ref`、路径根和事件净化等机械细节收进具名 API。它也让 TypeScript 根据 `state()` 的泛型检查 `action.set("newTitle", ...)` 和 `ref.state("newTitle")` 的路径/值类型。

## 4. 为什么不允许任意的“宏函数”

“编译期宏”不能等价于“允许用户运行任意函数，然后试图把结果序列化”。例如以下写法必须拒绝：

```ts
action.set("total", () => price * quantity); // 闭包和任意 JS
action.call(`orders.${getRegion()}`);          // 构建结果依赖任意执行
view.forEach("item", list.sort(compare), renderItem); // 外部函数不可序列化
```

否则 compiler 无法可靠地知道行为、依赖、权限和下发后的含义。正确模型是 **受限的、可静态识别的宏调用**：每个 DSL API 都是语言构造器，compiler 只接受它们及白名单中的字面量/对象/数组。编译器读取 TypeScript AST，把宏调用转为 Document AST；正常运行这些函数不是主要实现路径。

## 5. 编译规则

### 5.1 compiler 接受

- 一个模块默认导出的 `defineDocument({ ... })` 调用；
- 从 `@domily/next` 导入的具名 DSL 构造器；
- 字面量、对象、数组、模板字符串（仅静态片段）；
- `view.repeat({ each, in, key, template })` 等显式模板构造器；
- 模块顶层、纯静态、可被 compiler 内联的 `const` 声明；
- TypeScript 类型标注、`as const` 和可被 compiler 安全消除的类型信息。

### 5.2 compiler 拒绝

- 任何未识别函数调用；
- 局部变量、闭包引用、条件/循环语句、赋值、await、动态 import；
- `Date`、`Map`、`Set`、class 实例、symbol、bigint、正则和函数值；
- 展开运算符，除非将来能严格证明其来源为静态对象；
- `any` 逃逸、动态属性名和由字符串拼接出的 state/capability 路径。

### 5.3 静态 `const` 的边界

作者模块允许模块顶层 `const`，用于命名静态 UI 片段、样式令牌和字面量配置，降低重复：

```ts
const dangerTone = "danger" as const;
const retryButton = view.button({
  label: "重试",
  onClick: action.run("reload"),
});

export default defineDocument({
  // 可以引用 dangerTone 和 retryButton；compiler 在构建时内联它们。
});
```

静态 `const` 只有编译器的内联含义：

- 只能出现在 author module 的顶层，且必须具有可静态求值的 initializer；
- 不产生 AST 变量节点、不产生 runtime 词法作用域，也不写入/读取全局词法环境；
- 不允许函数、闭包、函数调用（DSL 构造器除外）、可变值、动态属性访问或跨模块的值导入；
- 编译后其绑定完全消失，`Document AST` 不保留常量名或执行环境。

这使开发者可以组织配置，但不会将 JavaScript 的作用域、求值顺序或副作用带回可下发协议。

编译器应报带行列号的错误，并在开发模式暴露 `--emit-ast`，让开发者查看与审阅产生的标准 AST。

## 6. AST 生成示例

下面这段 DSL：

```ts
action.try(
  [
    action.call(cap("todos.list"), { assign: "response" }),
    action.set("todos", ref.var("response.items")),
  ],
  { catch: [action.set("error", ref.error("message"))] },
);
```

编译为以下 IR（展示用途，实际 runtime 读的是带 `kind` 的 AST 节点）：

```json
{
  "kind": "try",
  "body": [
    { "kind": "call", "capability": "todos.list", "assign": "response" },
    {
      "kind": "set",
      "path": "state.todos",
      "value": { "kind": "reference", "path": "vars.response.items" }
    }
  ],
  "catch": [
    {
      "kind": "set",
      "path": "state.error",
      "value": { "kind": "reference", "path": "vars.error.message" }
    }
  ]
}
```

DSL 与 AST 一一对应且没有隐藏计算，因此相同页面可以由开发者通过 DSL 写出、由 AI 生成 JSON 交付、或由编辑器直接编辑 AST。

## 7. 第二阶段作者体验

待 DSL + AST MVP 稳定后，再按真实痛点添加，而不是先造多种语言：

1. **模板语法**：例如 `.domily` 文件中的 `<Button on:click={run("save")}>`，其语义必须编译到同一 DSL/AST；
2. **YAML/TOON 直接作者格式**：适合配置密集、批量文档与 AI 生成；TOON 是 AI 的默认输出，但交互仍使用 AST/动作构造；
3. **视觉编辑器**：以 AST 作为存储/协作格式；
4. **开发者 helper 包**：提供表单、资源、列表等高阶受限宏，但其产物仍只能是 AST。

不建议同时维护 JSON、YAML、TOML、TOON、模板语言和 TypeScript DSL 的等价“手写交互语法”。唯一真实语言是 AST；作者界面在需要时编译到它。

## 8. 与 capability 的关系

本地 DSL 不是逃离 capability 边界的后门。以下写法依旧只是对 capability 的静态引用：

```ts
action.call(cap("orders.submit"), {
  args: { items: ref.state("form.items") },
});
```

业务函数实现仍由宿主注册：

```ts
runtime.registerCapability("orders.submit", {
  input: OrderInput,
  execute: (input, context) => orders.submit(input, context.userId),
});
```

本地开发的 DSL 可以获得 capability 名称和输入类型的自动补全；编译后的文档在服务端下发后仍会再次检查 capability 是否声明、注册和授权。

## 9. 构建产物与调试

建议 Vite 插件在开发期提供：

- `.domily.ts` -> `.domily.json` / AST module 的编译；
- 原始 DSL 位置到 AST 节点的 source map；
- `?domily=ast` 虚拟模块或 `--emit-ast` 输出；
- 生成 AST 与校验错误回链到 DSL 源码；
- 生成配置的快照测试辅助。

生产构建可内联 AST 到应用包，或把 AST 输出成独立 JSON 供 CDN/服务端分发。两种方式都必须共享同一个 `Document AST` validator。

## 10. MVP 实现顺序

1. 先冻结 AST 类型与 JSON codec fixture；
2. 再实现 TypeScript compiler 的最小白名单：`defineDocument`、`state`、`ref`、`derived`、`action`、`view.repeat` 与模块顶层静态 `const`；
3. 对每个 DSL fixture 断言生成 AST 与 JSON fixture 等价；
4. 接入 Vite 开发模式的编译错误和 `emit-ast`；
5. 将第一份真实页面同时写成 DSL 与 JSON AST，前者给开发者、后者给 runtime/服务端；
6. 在此之后才评价是否需要模板语言、YAML/TOON 作者格式或视觉编辑器。

## 11. 已确认的作者规则

1. 每个 `.domily.ts` 模块只能有一个默认导出的 `defineDocument`；可复用组件和静态片段通过受限构造器/静态 `const` 组织，不能再导出独立 Document。
2. 列表使用专用的 `view.repeat({ each, in, key, template })`，不把箭头函数作为协议层的列表模板 API。
3. 允许模块顶层纯静态 `const`；它没有独立的 runtime 词法作用域，也不影响全局词法环境，编译后必须完全内联消失。
4. AI 输出由场景决定：本地开发与需要人工维护时优先 DSL；AI 默认生成 TOON AST；服务端下发、缓存和机器交换使用 JSON AST。TOON codec 是后续实现，不阻塞 JSON MVP。

## 12. 可复用片段与组件规则

### 12.1 `view.repeat`、fragment 与 key

`view.repeat.template` 允许单节点或 `view.fragment([...])`，与 Vue/React 的列表渲染体验一致。`key` 由作者优先显式提供；若未提供，renderer 使用 index 作为兜底 key。MVP 应在开发模式对缺少 key 的动态列表给出诊断，因为 index 在插入、删除、排序时可能造成 DOM/局部状态复用错误，但不阻断渲染。

```ts
view.repeat({
  each: "item",
  in: ref.state("items"),
  key: ref.item("item", "id"),
  template: view.fragment([
    view.text({ value: ref.item("item", "title") }),
    view.button({ label: "删除", onClick: action.run("removeItem") }),
  ]),
});
```

`view.fragment` 不产生额外 HTML 元素；adapter 为 fragment 内的每个根节点维护同一个 repeat item identity。

### 12.2 静态 `const` 引用

模块顶层静态 `const` 可引用此前已经声明的静态 `const`。compiler 构造依赖图并做拓扑展开；出现直接或间接循环引用立即抛出带源位置的编译错误。不能通过声明提升或延迟求值绕过这个规则。

### 12.3 三种复用方式

在一个 `defineDocument` 的约束下，三种方式都支持：

1. 静态 `const` 片段：复用同文件的已内联静态 view/action 值；
2. `view.fragment()`：组织多个静态/动态子节点，不产生额外 DOM；
3. `view.component("ComponentName", props)`：引用宿主注册的可复用组件，组件契约仍由注册表校验。

它们不产生第二个 Document，也不允许将任意本地函数作为 component render 函数传入。

## 13. HTML 映射边界

`view.component()` 和 HTML 专用构造器只能引用宿主已注册的组件定义。通用 HTML 映射的允许标签、props、URL、样式与事件 payload 由 [0005-html-component-policy.md](./0005-html-component-policy.md) 统一规定；DSL 不能以任意属性对象绕过注册表。
