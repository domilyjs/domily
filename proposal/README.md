# Domily Next Proposals

本目录记录 Domily Next 的设计提案。提案先定义问题、边界和可验证的协议，再决定运行时与渲染适配器的实现。

## 状态

| 提案 | 状态 | 说明 |
| --- | --- | --- |
| [0001-schema-driven-ui.md](./0001-schema-driven-ui.md) | 讨论中 | 可序列化、受限且可审计的 UI 协议草案 |
| [0002-document-codecs.md](./0002-document-codecs.md) | 被 0017 重述 | 历史 Document codec 方案；PageSpec SourceCodec 已另行实现 |
| [0003-authoring-dsl.md](./0003-authoring-dsl.md) | 已被 0013 取代 | 历史作者 DSL / compiler 方案（实现已删除） |
| [0004-document-delivery.md](./0004-document-delivery.md) | 被 0017/M4 重述 | 历史 Document delivery 职责；新 envelope / memory cache 已实现 |
| [0005-html-component-policy.md](./0005-html-component-policy.md) | 部分被 0014 取代 | 通用 HTML 映射的白名单与安全边界（样式策略已更新） |
| [0006-action-runtime.md](./0006-action-runtime.md) | 已被 0018 取代 | 历史 action runtime 方案（实现已删除） |
| [0007-dom-renderer-adapter.md](./0007-dom-renderer-adapter.md) | 已被 0019 取代 | 历史 DOM AST renderer 方案（实现已删除） |
| [0008-dom-host-composition.md](./0008-dom-host-composition.md) | 已被 0019 取代 | 历史 host/loader 组合方案（实现已删除） |
| [0009-vite-authoring-integration.md](./0009-vite-authoring-integration.md) | 已被 0018 取代 | 历史 `.dmy.ts` AST compiler 方案（实现已删除） |
| [0010-examples.md](./0010-examples.md) | MVP 已实现 | 业务开发者可运行的 Vite + Todo 基线示例工程 |
| [0011-public-sdk-and-authoring.md](./0011-public-sdk-and-authoring.md) | 已取代 | 历史的单核心包与低样板作者体验决策 |
| [0012-package-boundaries.md](./0012-package-boundaries.md) | 部分被 0018 取代 | Core、独立 codec 与独立 Vite 插件的单向依赖边界 |
| [0013-page-spec-product-reset.md](./0013-page-spec-product-reset.md) | 决策已实施 | 从执行 AST 回到面向开发者、AI 与动态交付的业务页面配置模型 |
| [0014-pagespec-authoring-model.md](./0014-pagespec-authoring-model.md) | 部分被 0015 取代 | PageSpec UI 语法、原始 HTML 与开放样式；业务页面语义已下沉为预设 |
| [0015-minimal-core-and-extension-model.md](./0015-minimal-core-and-extension-model.md) | M1–M2 已实现 | 克制的基础核心、Catalog 与业务可选预设 / extension 模型 |
| [0016-catalog-capability-contract.md](./0016-catalog-capability-contract.md) | M1–M2 已实现 | 本地 Catalog、capability、extension 的版本、契约、AI 上下文与动态化安全边界 |
| [0017-source-codec-and-delivery-boundary.md](./0017-source-codec-and-delivery-boundary.md) | M3–M4 核心已实现 | 多格式 source codec、parse 阶段 source map、原始 payload 与安全交付/缓存边界 |
| [0018-pagespec-migration-and-mvp-plan.md](./0018-pagespec-migration-and-mvp-plan.md) | M1–M5 已实现，M6 待实现 | PageSpec 重构、原生 DOM、codec、远程 delivery 与生态阶段门槛 |
| [0019-native-dom-host-mvp.md](./0019-native-dom-host-mvp.md) | M2 已实现 | PageHost、trusted renderer、scope/binding、native HTML 与 lifecycle 契约 |
| [0020-trusted-extension-runtime-and-preset-admission.md](./0020-trusted-extension-runtime-and-preset-admission.md) | M5 已实现 | 本地可信 extension runtime、远程可用性与业务预设准入门槛 |

## 约定

- 一个提案只解决一个决策主题。
- 公开 PageSpec 独立于序列化格式；JSON、YAML、TOML、TOON 与 BSON 等格式只是 source codec，均须先解析为通用值，再由同一个 PageSpec normalizer 解释。私有 ExecutionPlan/AST 不是作者格式。
- JSON 是 MVP 的唯一必选 codec；其他 codec 的实现不影响协议语义。
- 未决问题保留在提案末尾，确认后再进入实现任务。
