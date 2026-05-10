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

## 渐进式挖掘策略（当目标是非结构化内容提取时）

NotebookLM 每次返回的文本量有限（通常几百到几千字）。当用户需要从视频/文档中提取结构化深度内容时，**不要一次性要求全部内容**，而是采用渐进式多轮提问：

### 核心理念

每轮提问基于前一轮结果的**反思**，而非预先规划所有问题。作为编排者，你要：

1. **阅读上一轮 NotebookLM 的返回**
2. **判断覆盖了哪些、遗漏了哪些**
3. **据此精炼下一轮的问题**，使其更聚焦、更具体

### 典型多轮挖掘流程

以从 YouTube 视频提取多章节教程为例：

```
Round 1: 获取整体结构
  "Break down this video into a chapter outline. List main topics."
  → 拿到大纲后，识别哪些章节需要深入

Round 2-8: 逐章节深入（每轮一个主题）
  "Extract the section about [X]. Cover: (1) ... (2) ... Write as tutorial."
  → 基于前一轮未覆盖的细节，精炼下一轮 prompt

Final: 补充遗漏
  "What else was covered that we haven't extracted yet?"
```

### 提问技巧

| 原则 | 说明 |
|------|------|
| **一次一个主题** | 不要一次问多个不相关的章节 |
| **要求结构化输出** | 用编号列表、对比表等指定输出格式 |
| **给出具体方向** | "Cover: (1) definition, (2) example, (3) code" 比 "explain X" 好 |
| **基于遗漏反思** | 看完结果再问 "what else was covered about Y that we missed?" |
| **先粗后细** | Round 1 大纲 → Round N 细节，不要在 Round 1 就追问太细 |

### 产出物组织

多轮挖掘的最终产物应组织为：
```
{output-dir}/
├── README.md          # 教程索引，含目录和关键概念速览
└── chapters/
    ├── ch01-xxx.md    # 每章一个 markdown 文件
    ├── ch02-xxx.md
    └── ...
```

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
- **内容挖掘采用渐进式**：先粗后细，每轮基于前一轮反思精炼问题
- **Auth 故障不立即宣告失败**：先尝试 CDP 刷新、Chrome 重连等既定恢复路径