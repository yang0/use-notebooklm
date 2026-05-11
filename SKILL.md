---
name: use-notebooklm
description: 从已澄清或已足够明确的用户意图出发，编排 NotebookLM 执行。用于 ask、导入 source、发起 research、生成 audio/report/video/quiz/flashcards、以及下载产物，并且只在真正阻塞时才继续澄清。
---

# use-notebooklm

## 这个 skill 是干什么的

这个 skill 是 NotebookLM 的编排层。

它不替代 `intent-identification`，也不替代底层的 `notebooklm` 执行能力。
它负责把“已经足够明确的用户需求”收口成明确可执行的 `notebooklm_request_v1`，然后驱动 NotebookLM 直到用户真正拿到结果。

它的职责是：
1. 只在真正阻塞时澄清
2. 把明确意图映射成 `notebooklm_request_v1`
3. 根据目标 notebook 选择“新建”或“使用现有”
4. 调用 `notebooklm`
5. 跟进到最终结果完成，而不是只停在命令启动成功

## 默认主路径

默认主路径是：
1. 先判断用户意图是否已经足够明确
2. 如果不够明确，先走 `intent-identification`
3. 如果已经足够明确，直接构建 `notebooklm_request_v1`
4. 明确 notebook 目标：现有 notebook 或新建 notebook
5. 根据 action 执行 NotebookLM
6. 如果过程中出现 source add 超时或状态不明，先用 `notebooklm source list --json` 对账
7. 持续推进，直到用户要的产物、结论或下载结果真正完成

默认原则：
- 能直接执行时，不额外追问
- 不能安全执行时，只问一个真正阻塞的问题
- 不要把“发起命令”误当成“任务完成”

## Prerequisites（环境前置）

开始前至少确认：
- 用户意图已经足够明确，或者已有 `intent_contract_v1` 且 `status: READY`
- 已明确 notebook 目标：使用现有 notebook，还是新建 notebook
- action 所需输入已具备，例如 source、prompt、generation instructions、下载路径
- 长流程动作已经预留长超时预算；需要确认时要先拿到确认
- **NotebookLM 认证已就绪**（见下方「认证前置」）

如果上述任一项仍是阻塞未知项，就先继续澄清，不要过早调用 `notebooklm`。

### 认证前置（必须首先完成）

NotebookLM CLI 需要 Google 账号认证。由于 `notebooklm login` 是交互式的，本 skill 内置了 **CDP 认证脚本** 绕过此限制。

**Step 1: 一键认证（推荐）**

```bash
python scripts/cdp_login.py --launch-chrome
```

这会自动启动 Chrome（使用 `G:\chrome_data\remote_debug` profile，需已登录 Google/NotebookLM），提取认证 cookies，保存为 `~/.notebooklm/profiles/default/storage_state.json`。

**Step 2: 手动控制 Chrome（备选）**

如果 Chrome 已在运行：

```bash
python scripts/cdp_login.py --port 9223
```

手动启动 Chrome CDP：

```powershell
Start-Process "chrome.exe" -ArgumentList `
  "--remote-debugging-port=9223",
  "--user-data-dir=G:\chrome_data\remote_debug",
  "--remote-allow-origins=*",
  "about:blank"
```

**Step 3: 确认认证有效**

```bash
notebooklm status
```

**❗ 常见认证失败的根因**:

| 症状 | 根因 | 解决 |
|------|------|------|
| `Redirected to: accounts.google.com` | cookie 过期或被拒绝 | `python scripts/cdp_login.py --launch-chrome` |
| `Missing required cookies: {'SID'}` | Chrome profile 未登录 NotebookLM | 在 Chrome 中打开 notebooklm.google.com 确认已登录 |
| `CSRF token not found` | TLS 指纹被识别为非浏览器 | `pip install curl_cffi` |
| 旧 `--cookie` 配置覆盖 | config.json 残留 | 删除 `~/.notebooklm/config.json` |

> **自包含**: 本 skill 通过 `scripts/cdp_login.py` 独立完成认证，不依赖 notebooklm-py 的 `--cdp-port` 扩展或任何外部 skill。

对于 NotebookLM 多步长流程（例如 create + add source + wait + 多轮 ask / generate），不要依赖短默认超时。通过 Bash 调用时，建议显式设置 `timeout >= 1800000` ms（30 分钟）。

## 支持的 action

`notebooklm_request_v1` 支持：
- `ask`
- `add-sources`
- `add-research`
- `generate-audio`
- `generate-report`
- `generate-video`
- `generate-quiz`
- `generate-flashcards`
- `download`

不要发明这个契约之外的动作名。

## 输入依赖

优先接受来自 `intent-identification` 的 READY 合同：

```json
{
  "contractVersion": "intent_contract_v1",
  "status": "READY",
  "intent": {
    "objective": "Create an audio overview from selected climate policy sources",
    "targetSubject": "climate policy",
    "targetAudience": "policy analysts",
    "deliverable": "NotebookLM audio overview plus downloadable mp3",
    "successCriteria": "audio covers key tradeoffs and is downloadable",
    "explorationAngles": ["cost", "equity", "implementation"],
    "constraints": {
      "language": "en"
    },
    "mustInclude": ["tradeoff analysis"],
    "mustExclude": []
  },
  "openQuestions": []
}
```

如果用户本轮已经把问题说得足够具体，例如：
- 直接问某个 notebook 的问题
- 明确要把给定链接加入 NotebookLM
- 明确要做一次 exploratory research scan

那么可以不强制再走一轮额外澄清，直接映射为 `ask` 或 `add-research`。

## notebook 目标写法

### 使用现有 notebook

`request.notebookTarget.targetMode: "existing"`

要求：
- 必须提供 `notebookId` 或 `notebookTitle` 二选一
- 不能两者都缺失

### 新建 notebook

`request.notebookTarget.targetMode: "create"`

要求：
- 必须提供 `createNotebookTitle`
- 不能再带 `notebookId` 或 `notebookTitle`

## NotebookLM 核心约束

### Source 数量上限

**单 notebook 最多容纳 30 条 source**（URL、PDF 混合计入）。

这意味着：
- 无法一次性导入大量 source 后逐轮挖掘
- 必须策略性地管理 source：先放索引/大纲类 source，获取整体结构后，再根据反思替换或补充关键章节的 source
- 当需要深入特定章节时，可能需要移除已充分挖掘的 source，为新 source 腾出空间

### 返回长度限制

NotebookLM 每次返回的文本量有限（通常几百到几千字）。**不能一次性要求获取全部内容**。

必须采用渐进式策略：
- 先获取索引/大纲（低 source 消耗）
- 基于返回内容反思，识别遗漏和重点
- 再决定下一轮要深入哪些部分
- 每轮只聚焦一个主题或章节

## source readiness 规则

`request.options.sourceReadinessMode` 只允许两种：

### `allow-partial-ready`

适用：
- 仅适合 exploratory `ask`
- 当用户更需要尽快看到初步综合，而不是等全部 source 都 ready

要求：
- 回答中必须明确说明只基于 ready 子集得出结论

### `require-all-ready`

适用：
- `generate-*`
- `download`
- 其他非探索型执行默认也建议用这个模式

要求：
- 必须等所需 source 都 ready，才能继续

## `notebooklm_request_v1` 示例

### READY

```json
{
  "contractVersion": "notebooklm_request_v1",
  "status": "READY",
  "request": {
    "action": "generate-audio",
    "notebookTarget": {
      "targetMode": "existing",
      "notebookId": "abc123de-1111-2222-3333-444455556666"
    },
    "input": {
      "generationInstructions": "Create a concise 8-10 minute overview focused on policy tradeoffs.",
      "sources": [
        "https://www.youtube.com/watch?v=example123",
        "https://example.org/policy-brief",
        "https://example.org/market-analysis"
      ]
    },
    "options": {
      "language": "en",
      "sourceReadinessMode": "require-all-ready",
      "sourceIds": ["src_001", "src_014"]
    },
    "confirmation": {
      "userConfirmed": true,
      "userConfirmedLongRunning": true
    }
  },
  "openQuestions": []
}
```

### NEEDS_CLARIFICATION

```json
{
  "contractVersion": "notebooklm_request_v1",
  "status": "NEEDS_CLARIFICATION",
  "request": {
    "action": "ask",
    "notebookTarget": {
      "targetMode": "existing",
      "notebookTitle": "风水人群商品蓝海"
    },
    "input": {
      "askPrompt": "哪些商品方向最值得先验证？"
    },
    "options": {
      "sourceReadinessMode": "allow-partial-ready"
    },
    "confirmation": {
      "userConfirmed": false
    }
  },
  "openQuestions": [
    "你更想先看 TOP10 蓝海清单，还是带客单价/打法的机会矩阵？"
  ]
}
```

## action 映射规则

### `ask`

要求：
- 必须有 `input.askPrompt`
- 可选 `options.sourceIds`、`options.language`
- 默认 readiness 可用 `allow-partial-ready`

**⚠️ 重要：ask 的输出模式选择**

| 模式 | 命令 | 适用场景 | 注意事项 |
|------|------|----------|----------|
| **文本模式**（推荐） | `notebooklm ask "..." -n <id>` | 内容挖掘、获取回答 | 返回完整回答文本，适合阅读和分析 |
| **JSON 模式** | `notebooklm ask "..." -n <id> --json` | 程序化提取 citations | **只返回引用片段，不返回回答文本**，不适合内容阅读 |

**渐进式挖掘时，使用文本模式获取可读的完整回答。**

**⚠️ 多 notebook 上下文问题**：当 source add 成功后，notebooklm CLI 可能自动 resume 到之前操作的 notebook。后续 ask 必须显式指定 `-n <notebook-id>`，否则可能提问到错误的 notebook。

### `add-sources`

要求：
- 必须有 `input.sources`，且为非空数组
- 支持普通网页链接、YouTube 链接、混合 source 批次
- 如果任一 source add 结果超时或状态不明，先执行 `notebooklm source list --json` 对账，再决定是否继续

### `add-research`

要求：
- 必须有 `input.researchQuery`
- 必须有 `confirmation.userConfirmedLongRunning: true`
- 可以配合 `targetMode: "create"` 新建 notebook
- 它本身就是获取 source 的步骤，因此不要求在启动前所有 source 都 ready

### `generate-audio | generate-report | generate-video | generate-quiz | generate-flashcards`

要求：
- 必须有 `input.generationInstructions`
- 必须有 `confirmation.userConfirmedLongRunning: true`
- 必须使用 `options.sourceReadinessMode: "require-all-ready"`

### `download`

要求：
- 必须有 `input.download.artifactType`
- 必须有 `input.download.outputPath`
- 必须有：
  - `confirmation.userConfirmedLongRunning: true`
  - `confirmation.userConfirmedFilesystemWrite: true`
- 必须使用 `options.sourceReadinessMode: "require-all-ready"`

## Outputs（输出结果）

成功执行后，至少应返回：
- 规范化后的 `notebooklm_request_v1`
- 实际命中的 notebook 目标
- 已添加或已对账的 source 信息
- 生成产物的元数据，或已下载文件的本地路径
- 明确的完成状态，包括是否存在 partial-ready 情况

## 允许回退边界

这个 skill 的默认执行能力是 NotebookLM，本身不负责把问题悄悄切到别的主链工具。

允许的回退只有两类：
1. 回退到 `intent-identification`，因为当前需求还不够明确，无法安全执行
2. 回退到“状态对账 / 结果核验”步骤，例如 `notebooklm source list --json`，因为 create 或 source add 返回超时、传输错误或状态不明

边界要明确：
- 不要因为一次超时就立刻宣告失败
- 不要在 intent 未 ready 时强行调用 `notebooklm`
- 不要把模糊 source add 结果当成最终失败；先对账再判断
- 不要把下载、生成类任务降级成只返回“命令已启动”

如果对账后确认没有可用 source、目标 notebook 仍然不明确、或 action 必需输入缺失，才返回阻塞错误。

## 超时与对账策略

长流程建议显式长超时。
尤其是这类链路：
- `create`
- `source add`
- `source wait`（等待 source 处理完成，可能需数分钟）
- 多轮 `ask`
- 任意 `generate-*`
- `download`

推荐底线：
`timeout >= 1800000` ms（30 分钟）

短超时只适合：
- `notebooklm list --json`
- 单次轻量 `ask`
- 其他快速探测命令

对账规则：
- `notebooklm create --json`：先读顶层 `id`，再读 `notebook.id`
- `notebooklm source add ... --json` 若超时或返回不明：
  1. 运行 `notebooklm source list --json --notebook <id>`
  2. 如果 source 已出现且状态为 `ready` 或 `processing`，就按真实状态继续
  3. 如果没出现，再重试一次或标记排除
- `ask` 在 `allow-partial-ready` 下可以基于 ready 子集继续
- `generate-*` 和 `download` 必须等待必需 source 全部 ready

## 渐进式信息获取策略（核心工作流）

### 为什么必须是渐进式

NotebookLM 有两项硬约束决定了不能"一开始就规划好要获取什么"：

1. **Source 上限**：单 notebook 最多 30 条 source（URL/PDF 混合计入）
2. **返回长度限制**：每次返回通常只有几百到几千字

这意味着：
- ❌ 不能一次性导入所有 source 然后批量提取
- ❌ 不能预先规划 10 个问题然后依次执行（因为前 3 个问题的回答可能完全改变你对"重点在哪里"的判断）
- ✅ 必须是"**获取 → 反思 → 决定下一步**"的循环

### 核心理念：反思驱动，非计划驱动

**错误的思路**："我先问大纲，再问第一章，再问第二章..."（这是预先规划）

**正确的思路**：
1. **获取索引**：先获取整体结构（消耗少量 source slot）
2. **反思**：阅读返回内容，判断"哪些部分值得深入？哪些只是过渡？"
3. **决策**：根据反思结果，决定下一步要获取哪类信息
4. **执行**：可能涉及替换 source（移除已充分挖掘的，添加新 source）
5. **循环**：回到步骤 2

> **关键**：每一轮的问题都基于前一轮结果的**反思**，而非预先写好的脚本。

### Source 管理策略

由于 30 条上限，必须主动管理 source：

| 阶段 | 策略 | Source 数量 |
|------|------|-------------|
| **索引阶段** | 只放核心 source（如 1 个视频、2-3 个关键文档） | 1-5 条 |
| **深入阶段** | 保留必要上下文 source，替换已挖透的 source | 动态调整 |
| **验证阶段** | 用最小 source 集合验证关键结论 | 精简 |

**Source 替换原则**：
- 当某个 source 的内容已被充分提取，可以移除为新 source 腾位置
- 保留跨章节引用的核心 source（如主视频）
- 添加新 source 前先检查当前数量，必要时先移除

### 典型渐进式流程（以深度内容提取为例）

```
Phase 1: 索引构建
  导入核心 source（如主视频）
  Ask: "Break down this into a chapter outline. What are the main topics?"
  → 保存为 index.md
  → 反思：哪些章节是重点？哪些只是过渡？

Phase 2: 选择性深入（基于反思）
  根据索引判断："Chapter 3 看起来是核心方法论"
  Ask: "Extract Chapter 3 in detail. Cover: (1) core concept, (2) step-by-step process, (3) examples."
  → 保存为 chapter-03.md
  → 反思：是否遗漏了关键细节？是否需要补充前置知识？

Phase 3: 补充或修正（基于新的反思）
  "What important details about [X] were mentioned earlier but not covered in the last response?"
  或："The explanation of [Y] seems incomplete. What else was said about it?"
  → 追加到对应章节文件

Phase 4: 跨 source 关联（如需要）
  当涉及多个 source 时，先问："How does Source A relate to Source B on topic [Z]?"
  → 保存为 connections.md
```

### 每轮必须执行的反思清单

看完 NotebookLM 的返回后，必须回答：
- [ ] 这次返回覆盖了哪些内容？
- [ ] 哪些重要内容明显被省略或简化了？
- [ ] 是否有概念需要前置解释才能理解？
- [ ] 下一步最值得深入的是哪个部分？
- [ ] 当前 source 是否还有未挖掘的内容，还是需要换 source？

### 提问技巧

| 原则 | 说明 |
|------|------|
| **一次一个主题** | 不要一次问多个不相关的章节 |
| **要求结构化输出** | 用编号列表、对比表等指定输出格式 |
| **给出具体方向** | "Cover: (1) definition, (2) example, (3) code" 比 "explain X" 好 |
| **基于遗漏反思** | 看完结果再问 "what else was covered about Y that we missed?" |
| **先粗后细** | Round 1 大纲 → Round N 细节，不要在 Round 1 就追问太细 |
| **动态调整** | 根据返回随时改变下一步计划，不要坚持预设路径 |

### 产出物组织（多文件结构）

**必须保存为多文件**，而非单一大文件：

```
{output-dir}/
├── index.md              # 索引文件：目录结构、关键概念速览、source 清单
├── chapters/
│   ├── ch01-xxx.md       # 每章/每主题一个独立文件
│   ├── ch02-xxx.md
│   └── ...
└── meta/
    └── reflection-log.md # 反思记录：每轮获取的决策理由
```

**文件职责**：
- `index.md`：全局索引，方便快速定位
- `chapters/*.md`：分主题存储，单个文件不宜过长（便于 NotebookLM 后续引用）
- `meta/reflection-log.md`：记录每轮"为什么问这个问题"的决策过程，便于追溯

> **⚠️ 已知限制**：NotebookLM 对中文回答的编码支持不稳定，可能出现乱码。建议挖掘阶段用**英文提问**（NotebookLM 对英文处理更稳定），最终汇总输出时由编排层翻译成中文。

## 失败处理

以下情况不要猜，直接返回阻塞错误：
- intent contract 缺失或未 ready
- notebook 目标不明确
- action 必需输入缺失
- 长流程或下载所需确认缺失
- 上游 helper 没有产出可用 source
- 对账后仍没有可用于当前分析路径的 source

以下认证相关问题有既定恢复路径，**不要直接宣告失败**：

| 症状 | 恢复路径 |
|------|---------|
| `Authentication expired` | `notebooklm login --cdp-port 9223` 刷新认证 |
| `CSRF token not found` | 同上，确认 Chrome CDP 端口可访问 |
| `Missing required cookies` | 确认 Chrome profile 已登录 NotebookLM，用 `--cdp-port` 重新提取 |
| notebooklm 命令无响应 | 检查 `curl_cffi` 是否安装：`pip install curl_cffi` |

## 常见问题与解决方案

### 问题1：NotebookLM 对中文回答出现乱码

**症状**：ask 返回的中文内容显示为乱码（如 `����`）。

**根因**：NotebookLM 服务对中文字符的编码处理不稳定。

**解决**：
- 挖掘阶段使用**英文提问**，由 NotebookLM 处理英文内容
- 最终汇总时由编排层（当前 LLM）将英文结果翻译/重写成中文
- 或要求 NotebookLM "用中文回答" 作为 prompt 的一部分（成功率不保证）

### 问题2：`notebooklm ask --json` 只返回 citations，不返回回答文本

**症状**：使用 `--json` 模式后，输出只有引用片段列表，看不到 NotebookLM 的完整回答。

**根因**：`--json` 模式的设计用途是程序化提取引用信息，不是用于阅读回答。

**解决**：内容挖掘时使用**文本模式**（不加 `--json`），如果需要 citations 可以后续单独提取。

### 问题3：ask 提问到了错误的 notebook

**症状**：source add 成功后，后续的 ask 返回的内容与当前 notebook 无关。

**根因**：`notebooklm` CLI 在多 notebook 场景下可能 resume 到之前的会话上下文。

**解决**：**每个 ask 命令都显式指定 `-n <notebook-id>`**，不要依赖 CLI 的自动上下文恢复。

### 问题4：source 状态查询返回超时或空结果

**症状**：`notebooklm source add` 后查询状态没有响应。

**解决**：按对账策略执行 `notebooklm source list --json --notebook <id>`，检查 source 的真实状态。如果状态为 `processing` 或 `ready`，按真实状态继续。

## 相关脚本

- `scripts/validate_notebooklm_request.js`：校验并规范化 `notebooklm_request_v1`

## 行为总结

- **认证优先**：执行任何 action 前，先用 `notebooklm login --cdp-port 9223` 确保认证有效
- 需要时先走 `intent-identification`
- 每次最多只问一个真正阻塞的问题
- 将明确意图收口为 `notebooklm_request_v1`
- 用户已给出有效 YouTube 链接时，优先直接作为 NotebookLM source 导入
- create / source add 有歧义时，先对账再决定
- exploratory `ask` 允许基于 ready 子集继续
- 生成和下载必须等必需 source 全部 ready
- 执行目标是让用户真正拿到结果，而不是只启动命令
- **内容挖掘采用渐进式**：获取 → 反思 → 决定下一步，非预先规划
- **Source 管理意识**：始终注意 30 条上限，主动替换已挖透的 source
- **多文件输出**：索引 + 分章节文件 + 反思日志，禁止单一大文件
- **反思驱动**：每轮必须基于前一轮结果反思后再决定下一步，不要坚持预设路径
- **Auth 故障不立即宣告失败**：先尝试 CDP 刷新、Chrome 重连等既定恢复路径