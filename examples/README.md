# Domily Next examples

这里的每个一级目录都是独立的 workspace 包，目标是给业务开发者提供可复制、可运行的基础工程，而不是只展示 AST 片段。

| 示例 | 场景 | 启动方式 |
| --- | --- | --- |
| [`domily-next-vite-todo`](./domily-next-vite-todo/README.md) | 本地 `.dmy.ts` 文档、可信 capability、表单和列表交互 | `pnpm example:next-todo` |

后续示例会分别覆盖远程 envelope + IndexedDB 离线缓存，以及自定义受控组件注册表。它们不能改变当前协议或绕过 host validator。
