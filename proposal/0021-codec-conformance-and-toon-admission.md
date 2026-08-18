# 0021：Codec 一致性基准与 TOON 准入

- 状态：M6a 已实现；M6b 已实现，TOON 仍为 experimental
- 日期：2026-08-17
- 前置：[0017-source-codec-and-delivery-boundary.md](./0017-source-codec-and-delivery-boundary.md)、[0018-pagespec-migration-and-mvp-plan.md](./0018-pagespec-migration-and-mvp-plan.md)

## 1. 要解决的问题

`PageSpec` 已经是格式无关的 JSON-compatible 值，`SourceCodec`、Delivery 和 envelope 也已经允许
text/binary payload。真正还没有被证明的是：增加第二种文本格式时，是否会重新把 JSON 的解析逻辑、
Vite 行为或 PageSpec 语义复制一遍。

TOON 是面向 AI 的优先候选，因为它是 JSON 数据模型的紧凑、行式表示；但它的官方规范当前仍是
Working Draft。我们不能为了“尽快支持 TOON”手写一个不完整方言，然后把它称作标准 TOON。

M6 因而分为两个独立门槛：

```text
M6a：任何受信任的文本 codec 都能走同一 Vite / fixture / Delivery 边界
M6b：经过依赖审计的、版本固定的完整 TOON codec
```

## 2. 决策

1. core、normalizer、renderer 和 Delivery 不导入任何具体 codec；`@domily/next-codec-*` 继续单向依赖
   `@domily/next/codec`。
2. Vite 插件接受调用方传入的 `SourceCodecRegistry`。它按文件名的最长匹配后缀选择 codec，并只传入
   `{ kind: 'text', text }`；`.dmy.ts` 始终是普通 TypeScript、不能被 codec 覆盖，`.dmy.json` 保持无配置
   JSON fallback。
3. Vite 插件不会静态依赖 JSON、TOON、YAML 或任何未来 codec。业务应用明确安装并在 `vite.config.ts`
   注册所需 codec，保持依赖方向与 tree-shaking 边界。
4. `domily-next/codec-fixtures/` 保存格式无关的 canonical PageSpec 值。具体 codec 必须有自己的源文本，
   但解析结果必须与 canonical fixture 等价。
5. Delivery 接受带 SourceMap 的 parsed source 时，必须验证 `sourceMap.codecId === codec.id`、每个 range
   为半开区间且未越出原始 payload；不能把一个 codec 伪造的或越界的诊断映射带入缓存/交付结果。
6. codec 输出在进入 Vite 或 Delivery 前，都经过同一份无副作用的 JSON-compatible clone：拒绝函数、日期等
   非 plain object、`undefined`、symbol、getter/setter、循环、稀疏数组和非 index 数组属性，绝不借由
   `JSON.stringify()` 静默丢字段或调用 `toJSON()`。普通 JSON 键（包括 `"__proto__"`）保持为 null-prototype
   数据；PageSpec 与 manifest 边界再按各自的安全规则解释或拒绝它们。
7. M6b 使用官方 TOON 规范与其官方 TypeScript 参考实现，不引入私有“Domily TOON 子集”。唯一新增的
   第三方依赖被隔离在 `@domily/next-codec-toon`；解析器版本和锁文件完整性经审计后才进入实现。

这确保“AI 默认输出 TOON”只是文本表示选择，而不会变成第二种 PageSpec 语言或远程执行通道。

## 3. Vite 的通用文本入口

```ts
import { createSourceCodecRegistry } from '@domily/next/codec';
import { toonPageCodec } from '@domily/next-codec-toon';
import domilyNext from '@domily/next-vite-plugin';

export default {
  plugins: [
    domilyNext({
      codecs: createSourceCodecRegistry([toonPageCodec]),
      registry: pageRegistry,
    }),
  ],
};
```

当后缀为 `.dmy.toon` 时，插件调用该 codec 的 `parse()`，将得到的**通用值**序列化为 import-free ES module，
并可选调用同一个 `normalizePageSpec()` 做构建期诊断。codec 的语法错误保留自己的错误码和行/列；PageSpec
语义错误仍由 normalizer 产生。当前 SourceMap v1 尚没有 `PageSpecIssue.path → SourceNodeId` 映射，故不假装
能将语义诊断精确标回 TOON/YAML 行列。codec 的 1-based column 在交给 Vite/Rolldown 错误对象时会显式转换为
其要求的 0-based column，避免编辑器标记偏移一列。

生成模块通过 `JSON.parse(<escaped JSON string>)` 恢复数据，而不是把 JSON 直接嵌成 JavaScript 对象字面量；
这保证 JSON 中的 `"__proto__"` 等数据键不会在构建输出时改变对象原型或丢失。

binary codec（例如 BSON）不经过这个文本 transform。它们可用于 delivery、CLI 或将来的专用 asset adapter，
但不能把 Vite 已解码的源码字符串误当作原始字节。

## 4. SourceMap 的精确契约

`SourceLocation` 统一规定为：

- text payload：`line` / `column` 为 1-based，`offset` 为 0-based UTF-16 code-unit offset；
- binary payload：`offset` 为 0-based byte offset；没有文本位置时 `line` / `column` 可为 `0`；
- `SourceRange` 为 `[start, end)`；end 可以等于 payload 长度；
- `SourceMap.codecId` 必须与产生它的 `SourceCodec.id` 完全相同。

这些规则只定义 codec 的来源侧数据，不给 PageSpec 添加格式字段，也不把 SourceMap 加入签名的 PageSpec
语义。envelope 继续签名原始 payload 与 codec ID/version；cache 命中重新 parse 并重新生成来源信息。

## 5. Canonical fixture 规则

首个基准是 `domily-next/codec-fixtures/page-v1/todo.json`。所有新 codec 至少要验证：

| 项目 | 必须满足 |
| --- | --- |
| parse | 得到的值与 canonical JSON 等价，且 payload 保持原始文本/字节 |
| SourceMap | `codecId` 正确、根值可定位、范围合法；codec 私有 node ID 不跨格式比较 |
| normalize | 同一 `normalizePageSpec()` 结果，无 codec 私有 Catalog/binding/capability 语义 |
| serialize（若实现） | `parse(serialize(value))` 语义等价，不要求原始字节完全相同 |
| delivery | exact codec id/version、hash/signature、remote permission 与 cache reparse 都不因格式改变 |
| 失败 | 非法语法、错误 payload kind、非 JSON-compatible 结果和错误 SourceMap 都应安全失败 |

canonical fixture 不为某一种格式删减 JSON 值；某格式若不能无歧义表示该值，codec 必须报告错误或另行提出
显式映射，而不是静默变成字符串、日期对象或执行对象。

## 6. TOON M6b 的实现与准入记录

已实现的独立包如下：

```text
domily-next/codec-toon/             # @domily/next-codec-toon
  src/index.ts                      # toonPageCodec / parse / serialize
  test/fixtures/todo.dmy.toon       # 对应 canonical fixture 的 TOON 源文本
```

其公开 contract 已固定为：

- codec id：`toon`；source 后缀：`dmy.toon`；media type：`text/toon`；
- 只接受 text payload；binary payload 返回稳定的 `toon.payload.kind.invalid`；
- `TOON_SPEC_VERSION = "4.1"`、`TOON_PARSER_VERSION = "4.1.1"`；
- `SourceCodec.version` 是本地解析语义的 exact SemVer，供 envelope 精确匹配，**不是** PageSpec 版本，
  也不能含糊地只写“最新 TOON”。首版为 `TOON_CODEC_VERSION = "1.0.0"`；
- `serialize()` 输出确定性的 TOON，并拒绝无法以 JSON 数据模型安全表示的 JS 值；
- 不识别 `op`、`$ref`、`kind`、binding、Catalog 或 capability；上述字段仅是普通数据，PageSpec normalizer
  才解释其公开语义。

当前官方规范是 [TOON Specification 4.1](https://github.com/toon-format/spec)（Working Draft），官方 TypeScript
实现为 [`@toon-format/toon`](https://github.com/toon-format/toon)。首版的 root `SourceMap` node 是 `toon:`：官方
decoder 不暴露 AST/token range，因此 codec 只报告文档级来源，绝不手写一个不完整 parser 来伪造字段级 range。
官方 decoder 的语法错误有行号但没有列号时，codec 报该行的第 1 列。精确 TOON span 与
`PageSpecIssue.path → SourceNodeId` 映射仍是后续 SourceMap contract 的工作。

依赖审计记录（2026-08-17）：

1. 固定 `@toon-format/toon@4.1.1`，`pnpm-lock.yaml` 固定完整性为
   `sha512-SGCkS7IjVpwRmGPgnY8ENKpAf0EdAnZDOQkvFW0d2cgOpdn9FEFl7sTgryESyypXrWr0YajHGpwsAUX4zw9ZvA==`；
2. 审计该发布包的 manifest、tarball 和 npm provenance：无 runtime/peer/optional dependency、无 install hook；
   tarball 只包含声明、README、许可证与预构建 TypeScript ESM；
3. 发布日期满足 workspace 的 7 天最小年龄策略，安装仍通过 strict lockfile、严格依赖 build 与高危 audit
   策略；
4. parser 只由 `@domily/next-codec-toon` 依赖；core 和 Vite plugin 均不静态 import 它。应用必须显式把
   `createToonSourceCodecRegistry()` 传给 Vite 或 Delivery；
5. 已执行 canonical fixture、round-trip、Vite `.dmy.toon`、remote envelope exact codec/version 与 SourceMap
   回归。TOON 解析失败时仍可使用同一 PageSpec 的 JSON source fallback。

将来升级 parser 时必须重新审计 package、完整性、provenance 与 fixture 行为；若 parser 的 JSON-compatible
输出或错误位置语义变化，先提升 `TOON_CODEC_VERSION`，再允许新的 envelope 进入缓存。

本次 M6b 实施遵循的门槛为：

1. 固定具体 package version、integrity 和与 TOON 4.1 的对应关系；
2. 按 monorepo 既有依赖投毒策略审计发布者、依赖树、发布时间、许可证与 lockfile；
3. 让 parser 只作为 `@domily/next-codec-toon` 的依赖，绝不进入 core/Vite 的静态依赖图；
4. 跑官方 fixture、Domily canonical fixture、Vite `.dmy.toon` 和 Delivery envelope 的端到端回归；
5. 保持 JSON fallback：TOON parse/AI 输出失败时可退回同一 PageSpec 的 JSON，不丢失语义。

若官方 parser 的行为或维护状态以后不再满足这些条件，应停止升级或先提出替代 parser 的审计提案；不能以一个
“够用的”手写子集替换互操作性。

## 7. 不做的事

- 不在 M6a/M6b 添加 YAML、TOML、BSON 的解析实现；它们分别有不同的类型/二进制语义，需独立准入。
- 不在 codec 内创建执行 AST、expression、函数、模块 URL 或 capability handler。
- 不因为 TOON 更紧凑而让远程页面绕过现有 signature、catalog、extension、capability 或 runtime 授权。
- 不在此阶段实现 React/Vue adapter；它们仍只能消费现有 PageSpec / registry / capability contract。

## 8. 验收状态

M6a 已完成：Vite 的注入 codec 路径与诊断回归、shared canonical JSON fixture、JSON codec 的 fixture 回归、
以及 Delivery 对 SourceMap codec identity 和范围的防御性验证均已落地。

M6b 已完成：`@domily/next-codec-toon` 使用固定的官方 decoder，复用 codec-neutral Vite 与 Delivery 边界，
没有改变 core、normalizer 或 DOM host。它仍是 experimental：TOON 4.1 本身是 Working Draft，且 AI 生成质量
评估、字段级 TOON SourceMap 与 React/Vue adapter 都未在本阶段宣称完成。
