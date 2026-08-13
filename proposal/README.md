# Domily Next Proposals

本目录记录 Domily Next 的设计提案。提案先定义问题、边界和可验证的协议，再决定运行时与渲染适配器的实现。

## 状态

| 提案 | 状态 | 说明 |
| --- | --- | --- |
| [0001-schema-driven-ui.md](./0001-schema-driven-ui.md) | 讨论中 | 可序列化、受限且可审计的 UI 协议草案 |
| [0002-document-codecs.md](./0002-document-codecs.md) | 讨论中 | AST 优先的多格式 codec、限制与兼容性规则 |
| [0003-authoring-dsl.md](./0003-authoring-dsl.md) | MVP 部分已实现 | 面向开发者/AI 的作者 DSL 与 AST 编译边界；Vite 集成待实现 |
| [0004-document-delivery.md](./0004-document-delivery.md) | 已确认 | 服务端交付 envelope、验证与离线缓存职责 |
| [0005-html-component-policy.md](./0005-html-component-policy.md) | 已确认 | 通用 HTML 映射的白名单与安全边界 |

## 约定

- 一个提案只解决一个决策主题。
- 协议 AST 独立于序列化格式；JSON、YAML、TOML、TOON 与 BSON 等格式只是输入/输出 codec，均须规范化为同一 AST。
- JSON 是 MVP 的唯一必选 codec；其他 codec 的实现不影响协议语义。
- 未决问题保留在提案末尾，确认后再进入实现任务。
