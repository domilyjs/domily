# 0006：受限动作运行时、状态事务与 Capability 调用

- 状态：MVP 已实现
- 日期：2026-08-14
- 关联：[0001-schema-driven-ui.md](./0001-schema-driven-ui.md)、[0004-document-delivery.md](./0004-document-delivery.md)

## 1. 决策

`@domily/next` 核心包中的 runtime 模块是一个无 DOM、无网络、无存储依赖的 Document AST 解释器。它负责：

- 保存和读取文档本地 state；
- 纯计算引用与表达式；
- 顺序执行受限 `ActionNode`；
- 通过宿主显式注册的 capability 执行全部外部副作用；
- 记录可脱敏/采样的动作 trace。

它不负责解析、验签、缓存、组件白名单、DOM 事件原对象或渲染。Document 必须已经经过 codec、loader 和 host validator 后才能创建 runtime。

## 2. 状态与事务

一次 `dispatch`、`runAction` 或 `runLifecycle` 是一个事务：

```text
读取已提交 state
  -> 复制为 draft
  -> 顺序执行 action（可能 await capability）
  -> 成功：一次性提交 draft 并通知订阅者
  -> 未捕获异常、超过限制或 capability 拒绝：丢弃 draft
```

`try` 的 `catch` 和 `finally` 在同一 draft 中运行。被 `catch` 处理的错误不回滚此前步骤；未被处理的错误才回滚整个触发。这样“提交成功后刷新列表”的中间 loading 状态不会在失败时泄漏为半完成状态，但作者仍可在 `catch` 写入错误状态。

state 及 capability 的输入/输出必须是 JSON-compatible 数据；禁止函数、symbol、bigint、循环引用、`undefined`、原型链对象和危险键。每次写入均复制值，runtime 不保留宿主 capability 返回对象的引用。

## 3. 执行上下文

引用可读取的根对象：

| 根 | 来源 |
| --- | --- |
| `state` | 当前事务 draft |
| `derived` | `Document.derived` 的惰性纯计算结果 |
| `props` | 创建 runtime 时由宿主提供的 JSON-compatible props |
| `vars` | 当前动作序列的临时变量，例如 `call.assign` |
| `event` | renderer 净化后的可序列化事件 payload |
| 其他首段 | renderer/循环提供的显式 scope，例如 `todo` |

路径按受限段访问，不执行 JavaScript 成员访问。`__proto__`、`constructor`、`prototype` 始终拒绝。`derived` 可以引用 `state` 或其他 `derived`；循环依赖会产生 runtime 错误。

## 4. 表达式

表达式只处理 JSON-compatible 数据且没有副作用。MVP 支持 AST 已声明的：`eq`、`neq`、比较、布尔、算术、`concat`、`empty`、`coalesce`、`ternary`、`get`。

- `and` / `or` 短路并返回 boolean；
- `eq` / `neq` 使用结构化 JSON 等价；
- `add` / `sub` / `mul` / `div` 只接受 number，除零报错；
- `get` 接受对象/数组和值键，使用同一安全段规则；
- 参数数量或类型不匹配是确定性的 runtime 错误，不做 JavaScript 隐式转换。

## 5. 动作

| Action | 运行时行为 |
| --- | --- |
| `set` | 求值后写入 `state.*`；中间对象按需要创建。 |
| `merge` | 求值对象并浅合并至 `state.*`；目标不存在时创建对象。 |
| `toggle` | 仅翻转 boolean state 值。 |
| `if` | 求值条件，仅执行一个分支。 |
| `run` | 在同一事务与 vars scope 中执行命名 action；受递归深度限制。 |
| `call` | 验证声明、注册与权限后调用 capability；结果可写入 `vars.<assign>`。 |
| `try` | 在 catch 中提供标准化的 `vars.error`，finally 始终执行。 |

`request`、`navigate`、`emit` 不是独立解释器原语；宿主分别以 capability 提供。`while`、递归 action 图、任意函数和直接浏览器 API 均不支持。

## 6. Capability 契约

```ts
interface CapabilityContext {
  document: Document;
  event: JsonValue | undefined;
  props: JsonValue | undefined;
}

interface Capability {
  authorize?(context: CapabilityContext): boolean | Promise<boolean>;
  execute(args: JsonValue, context: CapabilityContext): JsonValue | Promise<JsonValue>;
}
```

运行时在调用前检查：文档声明了 capability、宿主注册了 capability、`authorize` 允许调用、参数可 JSON 化。宿主可在 capability 内部补充 schema、租户、用户和审计策略；不将这些业务策略编码进 Document。

## 7. Trace 与限制

每个触发返回以下最小 trace：触发来源、动作路径、state 写入路径、capability 名称、耗时和标准化错误。默认限制：最大 128 个 action step、最大 16 层 `run` 深度、最大 32 层 derived 依赖。超限导致事务回滚。

trace 不含 capability 原始输入、输出、event 或 props；宿主若需要调试数据，必须单独脱敏后记录。

## 8. MVP 验收

1. 表达式在相同 state/props/scope 下确定性求值，derived 循环被拒绝；
2. `set`、`merge`、`toggle`、`if`、`run`、`call`、`try` 在成功和失败路径均满足事务语义；
3. 未声明、未注册、未授权 capability 与危险 state path 被拒绝；
4. capability 失败可被 `try.catch` 转换为 `state.error`，finally 仍执行；
5. 递归与 action step 超限回滚 state；
6. trace 不泄漏 capability payload，并覆盖状态写入、调用与错误。
