# Domily Next Proposals

本目录记录 Domily Next 的设计提案。提案先定义问题、边界和可验证的协议，再决定运行时与渲染适配器的实现。

## 状态

| 提案 | 状态 | 说明 |
| --- | --- | --- |
| [0001-schema-driven-ui.md](./0001-schema-driven-ui.md) | 讨论中 | 可序列化、受限且可审计的 UI 协议草案 |
| [0002-document-codecs.md](./0002-document-codecs.md) | MVP 部分已实现 | JSON codec、来源追踪与多格式扩展边界 |
| [0003-authoring-dsl.md](./0003-authoring-dsl.md) | MVP 已实现 | 面向开发者/AI 的作者 DSL、静态 compiler、Vite 集成与作者 SDK |
| [0004-document-delivery.md](./0004-document-delivery.md) | 已确认 | 服务端交付 envelope、验证与离线缓存职责 |
| [0005-html-component-policy.md](./0005-html-component-policy.md) | 已确认 | 通用 HTML 映射的白名单与安全边界 |
| [0006-action-runtime.md](./0006-action-runtime.md) | MVP 已实现 | 受限动作、状态事务、capability 与 trace |
| [0007-dom-renderer-adapter.md](./0007-dom-renderer-adapter.md) | MVP 已实现 | DOM adapter、受控组件注册表与事件投影 |
| [0008-dom-host-composition.md](./0008-dom-host-composition.md) | MVP 已实现 | Loader、validator、runtime、renderer 的端到端宿主入口 |
| [0009-vite-authoring-integration.md](./0009-vite-authoring-integration.md) | MVP 已实现 | `.dmy.ts` 的 Vite 静态编译、诊断与本地 AST 模块 |
| [0010-examples.md](./0010-examples.md) | MVP 已实现 | 业务开发者可运行的 Vite + Todo 基线示例工程 |
| [0011-public-sdk-and-authoring.md](./0011-public-sdk-and-authoring.md) | 已取代 | 历史的单核心包与低样板作者体验决策 |
| [0012-package-boundaries.md](./0012-package-boundaries.md) | MVP 已实现 | Core 抽象、独立 codec 与独立 Vite 插件的单向依赖边界 |

## 约定

- 一个提案只解决一个决策主题。
- 协议 AST 独立于序列化格式；JSON、YAML、TOML、TOON 与 BSON 等格式只是输入/输出 codec，均须规范化为同一 AST。
- JSON 是 MVP 的唯一必选 codec；其他 codec 的实现不影响协议语义。
- 未决问题保留在提案末尾，确认后再进入实现任务。
