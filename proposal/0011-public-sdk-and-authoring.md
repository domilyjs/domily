# 0011：单核心包与低样板作者体验（历史决策）

- 状态：已由 [0012-package-boundaries.md](./0012-package-boundaries.md) 取代
- 日期：2026-08-14

本提案曾将 JSON codec 与 Vite plugin 的实现放进 `@domily/next`，再通过子路径和薄包暴露。这一安排虽然减少了示例中的直接依赖数，却混淆了运行时核心、文本格式实现和构建工具的依赖方向。

当前有效决策见 0012：`@domily/next` 只保留 AST、通用 codec 合约、runtime/host、作者 DSL 与 compiler；`@domily/next-codec-json` 和 `@domily/next-vite-plugin` 都是各自拥有实现、单向依赖 core 的独立包。

低样板作者 helper、直接 capability handler 与“业务代码不装配内部 host/registry”的目标仍然有效；仅包边界和安装方式以 0012 为准。
