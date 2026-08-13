# 0001：将 Domily Next 定义为可序列化 UI 协议

- 状态：已确认定位，待细化 MVP 契约
- 日期：2026-08-12
- 决策者：项目维护者

## 1. 问题陈述

当前 Domily 的渲染对象外观接近 JSON，但运行时语义依赖 JavaScript 函数：数据读取、响应式计算、事件、列表映射和生命周期都以函数传入。因此它是 **JS Object schema 渲染器**，不是可从 JSON、YAML、TOML、TOON 或 BSON 独立加载和执行的 UI 协议。

这没有错，但无法满足以下场景：页面由服务端下发、由低代码编辑器保存、由 AI 生成后校验、按租户/实验动态组合，以及在不信任配置内容时安全运行。

## 2. 要做与不做

### 要做

定义一个 UI 文档协议，使业务页面能以纯数据描述：

- 组件树、样式令牌与可访问性属性；
- 本地状态、派生值、条件与列表；
- 事件与生命周期触发的受限动作；
- 本地开发与服务端下发的同构加载、离线缓存和更新策略；
- 网络请求、导航和宿主注册能力的安全调用；
- 静态校验、版本迁移、权限控制和执行 trace。

### 不做

- 不在 JSON 字符串中执行任意 JavaScript（`eval`、`new Function`、动态导入）。
- 不在第一阶段重做虚拟 DOM、编译器或与 React/Vue/Svelte 竞争的通用渲染框架。
- 不承诺用纯配置实现任意复杂业务算法；复杂算法由宿主应用以受控 capability 提供。
- 不将 HTML 的全部属性和浏览器 API 直接暴露给远程配置。

## 3. 产品定位

Domily Next 是一个面向 **内部开发者与 AI 生成工具** 的 **Schema-driven UI 协议与运行时**。开发者以简单配置实现标准页面与交互；AI 生成同一份可校验的配置以产出复杂页面或组件；文档既可本地开发，也可由服务端下发。它不是一个通用 JavaScript 前端框架。

`Document AST` 是给编译器、校验器和 runtime 使用的中间表示（IR），不是开发者必须手写的日常格式。开发者和 AI 可以使用受限的作者 DSL；构建期将其编译为同一份 AST。本地作者语言与服务端下发的 AST 是不同层，不能混为一谈。

它的核心价值是让 UI 文档同时具备：

1. 可序列化：可保存、传输、差异比较和版本化；
2. 可限制：配置只能使用允许的组件、表达式、动作和能力；
3. 可验证：渲染前可做结构、类型、路径和权限检查；
4. 可审计：每次交互可追踪状态读写、请求与 capability 调用；
5. 可适配：协议可先渲染到 Domily DOM adapter，未来也可适配其他宿主。

长期目标是覆盖不同业务场景，而非在 MVP 先重做所有业务组件或浏览器能力。覆盖范围通过可扩展的组件注册表和 capability 生态实现。

## 4. AST 与多格式 codec 边界

JSON 不是协议本身，而是 `Document AST` 的第一个文本表示。YAML、TOML、TOON 和 BSON 都只能作为同一 AST 的 codec，不能各自引入新语义、默认值或运行时行为。

```text
JSON / YAML / TOML / TOON / BSON
             │
             ▼
        codec.decode()
             │
             ▼
       Raw Document Value
             │
             ▼
 normalizeDocument()     # 仅补齐协议定义的标准默认值与规范化表示
             │
             ▼
        Document AST
             │
             ▼
 validate -> migrate -> runtime -> renderer adapter
```

codec 负责把各自的字节/文本语法转换为 `Document AST`，并提供格式相关的诊断；它不能引入协议语义、调用 capability、访问 DOM 或做运行时校验。`Document AST` 才定义表达式、动作和版本语义。由于 TOML、YAML、BSON 与 JSON 的原生数据模型并不完全一致，codec 不以“任意对象的无损互转”为目标；每种格式必须明确支持范围和规范化规则。详见 [0002-document-codecs.md](./0002-document-codecs.md)。

### 4.1 MVP 约束

- MVP 实现 `json` codec 与 `Document AST` 的明确 TypeScript 类型；
- `DocumentLoader` 接口从第一天起接受 codec，避免 JSON 细节泄漏到 runtime；
- YAML、TOML、TOON、BSON codec 在协议 fixture 测试通过后按需实现，不作为 MVP 阻塞项；
- 每个 codec 都必须产生与 JSON fixture 等价的规范化 AST；
- JSON 保持服务端分发与缓存的基准格式；TOON 是 AI 生成的首选作者/交换格式。TOON 是 JSON 数据模型的编码格式，其官方规范仍标为 Working Draft，因此它不应定义协议语义。[TOON 官方规范](https://github.com/toon-format/spec)

建议的初始边界：

```ts
interface DocumentCodec<Input = string> {
  readonly format: "json" | "yaml" | "toml" | "toon" | "bson" | string;
  parse(input: Input): CodecResult<Document>;
  serialize(document: Document): CodecResult<Input>;
}

interface DocumentLoader {
  load(input: unknown, codec: DocumentCodec): Document;
}
```

`Document` 是冻结后的规范化 AST。对于 BSON，要在 codec 层拒绝或明确规范化非 JSON 原生类型（如 `Date`、`ObjectId`、二进制值），避免不同输入格式得到不同运行时语义。

## 5. 核心模型

一个文档由以下七部分组成：

```text
Document
├── meta           # 协议版本、文档 ID、能力声明
├── state          # 可变的初始本地状态
├── derived        # 纯表达式定义的派生值
├── resources      # 受控远程数据源（可选）
├── actions        # 有副作用的动作序列
├── lifecycle      # 生命周期 -> 动作引用
└── view           # 组件树
```

表达式只能读取上下文并返回值；动作才允许写状态、请求、导航或调用 capability。这条分层是协议安全性与可分析性的基础。

## 6. 最小文档示例

```json
{
  "meta": {
    "protocol": "domily-next",
    "version": "0.1",
    "id": "todo-list",
    "capabilities": ["todos.list", "todos.create"]
  },
  "state": {
    "newTitle": "",
    "todos": [],
    "loading": false,
    "error": null
  },
  "derived": {
    "canSubmit": {
      "op": "not",
      "arg": { "op": "empty", "arg": { "op": "get", "path": "state.newTitle" } }
    }
  },
  "actions": {
    "loadTodos": [
      { "op": "set", "path": "state.loading", "value": true },
      {
        "op": "try",
        "body": [
          {
            "op": "call",
            "capability": "todos.list",
            "assign": "response"
          },
          { "op": "set", "path": "state.todos", "value": { "$ref": "vars.response.items" } },
          { "op": "set", "path": "state.error", "value": null }
        ],
        "catch": [
          { "op": "set", "path": "state.error", "value": { "$ref": "vars.error.message" } }
        ],
        "finally": [
          { "op": "set", "path": "state.loading", "value": false }
        ]
      }
    ],
    "createTodo": [
      {
        "op": "call",
        "capability": "todos.create",
        "args": {
          "title": { "$ref": "state.newTitle" }
        }
      },
      { "op": "set", "path": "state.newTitle", "value": "" },
      { "op": "run", "action": "loadTodos" }
    ]
  },
  "lifecycle": {
    "mounted": { "op": "run", "action": "loadTodos" }
  },
  "view": {
    "component": "Stack",
    "props": { "gap": "md" },
    "children": [
      {
        "component": "TextField",
        "props": {
          "label": "待办事项",
          "value": { "$ref": "state.newTitle" }
        },
        "events": {
          "input": {
            "op": "set",
            "path": "state.newTitle",
            "value": { "$ref": "event.target.value" }
          }
        }
      },
      {
        "component": "Button",
        "props": {
          "label": "新增",
          "disabled": { "op": "not", "arg": { "$ref": "derived.canSubmit" } }
        },
        "events": {
          "click": { "op": "run", "action": "createTodo" }
        }
      },
      {
        "component": "Alert",
        "when": { "$ref": "state.error" },
        "props": { "tone": "danger", "message": { "$ref": "state.error" } }
      },
      {
        "component": "List",
        "for": { "each": "todo", "in": { "$ref": "state.todos" }, "key": { "$ref": "todo.id" } },
        "template": {
          "component": "Text",
          "props": { "value": { "$ref": "todo.title" } }
        }
      }
    ]
  }
}
```

示例中的 `Stack`、`TextField`、`Button`、`Alert`、`List` 是组件注册表中的组件名。MVP 的注册表以通用 HTML 组件映射为主，例如 `div`、`form`、`input`、`button`、`table`、`label`、`section`；但它们仍需通过注册表声明可用 props、受支持事件和事件 payload，远程文档不能任意写入 DOM 属性或调用浏览器 API。

## 7. 值引用与表达式

### 7.1 引用值

`{ "$ref": "…" }` 从受限上下文读取值。允许的根路径：

- `state.*`：文档本地状态；
- `derived.*`：派生值；
- `props.*`：宿主传入的组件参数；
- `vars.*`：当前动作作用域的临时变量；
- 循环变量，例如 `todo.*`；
- `event.*`：经事件适配器净化后的事件数据。

`try` 的 `catch` 作用域会提供 `vars.error`，其内容是标准化后的错误对象。

引用路径不是 JavaScript 成员访问语法；解析器拒绝原型链键、函数调用和未声明根对象。

### 7.2 表达式 AST

当简单引用不足时，使用 JSON AST，而不是字符串表达式：

```json
{
  "op": "and",
  "args": [
    { "op": "gt", "args": [{ "$ref": "state.items.length" }, 0] },
    { "op": "eq", "args": [{ "$ref": "state.mode" }, "editing"] }
  ]
}
```

`0.1` 只提供有限、纯函数的操作符：`eq`、`neq`、`gt`、`gte`、`lt`、`lte`、`and`、`or`、`not`、`add`、`sub`、`mul`、`div`、`concat`、`empty`、`coalesce`、`ternary`、`get`。

表达式禁止网络、时间、随机数、修改状态和调用 JavaScript。这样同一个输入永远得到同一个输出，也能静态分析其依赖。

## 8. 动作 DSL

动作是顺序执行的 JSON 指令，可作为事件处理器、生命周期处理器或另一个动作的子步骤。第一版原语：

| 原语 | 效果 |
| --- | --- |
| `set` | 设置一个允许写入的 `state.*` 路径 |
| `merge` | 合并对象到一个 `state.*` 路径 |
| `toggle` | 翻转布尔状态 |
| `if` | 根据表达式选择 `then`/`else` 子动作 |
| `run` | 调用命名动作 |
| `call` | 调用已注册且已授权的 capability |
| `request` | 调用声明过的数据源（可作为 `call` 的语法糖，二选一实现） |
| `navigate` | 通过宿主路由能力导航 |
| `emit` | 向宿主或上级组件发送受控事件 |
| `try` | 定义 `body`、`catch`、`finally` 动作序列 |

不在 `0.1` 加入 `while`、递归、任意代码块或 DOM 选择器。动作能处理业务 UI 流程，但刻意不是通用编程语言。

## 9. Capability 边界

配置文档只声明希望使用的 capability；实际宿主必须显式注册实现和权限策略：

```ts
runtime.registerCapability("todos.create", {
  input: TodoInputSchema,
  execute: async ({ title }, context) => todoApi.create({ title, tenantId: context.tenantId }),
});
```

运行时在加载和执行时都检查：

1. 文档是否声明该 capability；
2. 宿主是否注册该 capability；
3. 当前用户/租户是否有调用权限；
4. 输入是否符合 capability 的 JSON Schema；
5. 输出是否可安全写入允许的状态路径。

这让配置可动态下发，而不会获得 fetch、DOM、localStorage、cookie 或任意模块导入的隐式权限。

## 10. 生命周期

协议层的生命周期只表达领域事件到动作的映射：

```json
{
  "lifecycle": {
    "mounted": { "op": "run", "action": "loadTodos" },
    "beforeLeave": { "op": "run", "action": "confirmDiscard" }
  }
}
```

第一版建议仅公开 `mounted` 和 `beforeLeave`。渲染器内部仍可拥有 mount/update/unmount 钩子，但不把原始 DOM 节点暴露给远程文档。需要聚焦、滚动等 UI 效果时，以宿主提供的 `ui.focus`、`ui.scrollTo` capability 实现。

## 11. 组件注册表

每个组件定义自己的 props、slots、事件和可绑定字段契约：

```ts
type ComponentDefinition = {
  name: string;
  propsSchema: JsonSchema;
  events: Record<string, EventPayloadSchema>;
  slots?: Record<string, SlotSchema>;
  render: DomilyAdapterComponent;
};
```

`view.component` 必须来自注册表。适配器把协议节点转换为目标渲染器节点；组件可以使用现有 Domily runtime，也可以在将来使用 React/Vue adapter。协议不能依赖某一个 adapter 的私有属性。

## 12. 本地、服务端与离线加载

同一份 `Document AST` 支持两个来源：

- **本地开发**：构建期从开发者选择的 codec 加载文档；
- **服务端下发**：运行时以已登记的 codec 获取并解码文档。

二者必须经过完全相同的 `normalize -> validate -> migrate -> mount` 流程，不能因来源不同而拥有不同语义或权限。服务端文档应携带稳定的 `meta.id`、协议版本、文档版本/内容摘要和缓存策略；宿主以 `id + revision`（或内容 hash）缓存已验证的 AST。离线时仅装载已验证且仍被宿主策略允许的缓存版本，不执行未经验证的网络响应。

服务端下发不意味着文档获得更多能力：仍受组件注册表、路径写入规则和 capability 权限策略限制。认证、签名、缓存过期与灰度分发是后续的宿主集成能力，不把它们编码进 UI AST。

## 13. 验证、限制与 trace

加载文档的最小流程：

```text
codec.decode (JSON/YAML/TOML/TOON/BSON)
  -> normalize to Document AST
  -> validate structural schema
  -> validate references, actions, component props, capability permissions
  -> apply optional version migration
  -> mount runtime
```

运行时强制设定文档体积、嵌套深度、表达式复杂度、动作步数、递归调用深度和请求超时上限。每次动作产生 trace：触发源、动作栈、读取/写入的 state 路径、capability 调用、耗时及错误。trace 对开发者可见，生产环境可脱敏/采样。

## 14. 与现有仓库的关系

不直接将 `@domily/runtime-core` 改造成该协议的解释器。现有接口的主语是函数和 JS 对象；协议的主语是可验证、可序列化的数据。两者硬兼容会形成两套彼此冲突的语义。

建议先新增独立包，并用现有 runtime 做第一个适配器：

```text
packages/
  runtime-core/          # 保持为 JS schema runtime；仅修复/维护
  ...
domily-next/
  ast/                   # experimental Document AST、构造器、规范化；不含 I/O
  spec/                  # AST 的 JSON Schema、版本迁移与校验
  codecs/                # DocumentCodec 接口与 JSON codec；其他格式可插拔
  compiler/              # 作者 DSL / 宏调用 -> Document AST；仅构建期使用
  expr/                  # 纯表达式求值与依赖分析
  actions/               # 动作执行、状态事务、trace
  runtime/               # 文档生命周期、注册表、权限协调
  dom/                   # 输出到现有 Domily runtime 的 adapter
```

只有协议与 MVP 被验证后，再讨论是否提取现有响应式或 DOM 渲染能力。现有项目不是废弃对象，而是可复用的第一个渲染后端和对比基线。

## 15. MVP 与验收标准

MVP 不做编辑器、多端渲染和任意业务逻辑。首个可交付 demo 是一个 **表单 + 列表组合页**：输入/校验/提交后刷新列表，具有加载、错误、重试和行操作状态。它既验证表单联动，也验证远程列表的异步交互。

MVP 不单独定义 `resources`；所有网络和业务副作用都通过 capability 完成。文档可以使用通用 HTML 组件映射，但能力与事件边界始终由注册表控制。

MVP 必须实现并验证：

1. 表单：字段校验、字段联动、提交、错误展示；
2. 列表：加载、筛选、刷新、行操作；
3. 同一页面中表单提交触发列表的受控刷新；
4. 通用 HTML 组件映射的属性、事件和 payload 白名单。

验收条件：

- 文档经 `JSON.stringify`/`JSON.parse` 后语义不变；
- runtime 仅依赖规范化 `Document AST`，不依赖 JSON 字符串或对象字段顺序；
- 用相同 fixture 实现的任何 codec，必须生成与 JSON codec 相同的 AST；
- 文档中不含函数、任意 JS 源码或动态导入；
- 未授权组件、事件、路径和 capability 在 mount 前失败；
- 每个示例的核心用户动作有可读 trace；
- 同一文档可通过现有 Domily adapter 运行；
- 至少具备文档校验、表达式、动作、capability 边界的自动化测试。

## 16. 已确认决策与尚待细化项

### 已确认

1. 首个用户是内部开发者与 AI 生成工具；
2. 同时支持本地开发、服务端下发与离线缓存；
3. 长期目标覆盖多种业务场景；通过组件与 capability 扩展，而非限制为单一页面类型；
4. 复杂业务逻辑由宿主 capability 实现；
5. JSON/YAML/TOML/TOON/BSON 都是 `Document AST` 的 codec，JSON 是 MVP 的必选实现；
6. 多租户权限、国际化、主题和设计令牌不进入 MVP。
7. 每个作者模块只允许一个 `defineDocument`；作者 DSL 的列表采用专用 `view.repeat` 描述，支持 fragment，作者优先给 key、index 兜底；模块顶层纯静态 `const` 允许引用此前静态常量，循环引用直接报错，编译后不产生 runtime 或全局词法作用域；静态片段、fragment 与宿主注册组件三种复用方式都支持；AI 默认生成 TOON AST，本地维护优先 DSL，服务端分发与缓存使用 JSON AST。
8. 服务端采用独立的交付 envelope：发布服务生成 revision/hash/可选签名，App Shell 的 Document Loader 获取、验证、缓存与离线回退，Runtime 只执行已验证 AST。
9. 通用 HTML 组件映射采用默认拒绝、显式白名单；禁止原始 HTML、内联事件、任意 URL 与任意样式。富文本、文件上传、拖放、嵌入内容等以后的专用组件 + capability 实现。详见 [0005-html-component-policy.md](./0005-html-component-policy.md)。

### 尚待细化

当前没有阻塞 MVP 的产品决策；下一步可将已确认提案落实为 AST 类型和测试规格。

对这些问题的答案将决定包边界、状态模型、组件契约和第一个可交付 Demo。
