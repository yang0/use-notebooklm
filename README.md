# use-notebooklm

独立的 NotebookLM 操作 skill。编排 NotebookLM 执行全流程——从认证到内容挖掘到产物生成。

## 能力

- **自包含认证**：通过 Chrome CDP 提取 Google 认证，不依赖交互式浏览器登录
- **NotebookLM 编排**：create → source add → ask → generate → download 全链路
- **渐进式挖掘**：多轮反思式提问策略，从视频/文档中提取结构化深度内容
- **契约化执行**：基于 `notebooklm_request_v1` 契约，可复现、可对账

## 前置环境

```bash
pip install notebooklm-py websocket-client curl-cffi
```

Chrome 需已登录 Google/NotebookLM（profile 路径默认为 `G:\chrome_data\remote_debug`）。

## 快速开始

```bash
# 1. 认证（只需一次，Chrome 需已登录 NotebookLM）
python scripts/cdp_login.py --launch-chrome

# 2. 创建 notebook 并导入 YouTube source
notebooklm create "My Analysis"
notebooklm source add "https://youtube.com/watch?v=..." -n "<id>"
notebooklm source wait "<source-id>" -n "<id>"

# 3. 检查 source 是否就绪
notebooklm source list --json --notebook "<id>"

# 4. 渐进式提问（文本模式，显式指定 notebook）
notebooklm ask "Break down this video into chapters" -n "<id>"

# 5. 逐轮深挖（每轮一个主题，基于前一轮结果反思）
notebooklm ask "Explain section X in detail..." -n "<id>"

# 6. 生成产物
notebooklm generate audio -n "<id>"
notebooklm download audio -n "<id>"
```

## 实战示例：YouTube 视频深度解析

本次执行了一个完整案例：从 YouTube 视频 "Don't Build Agents, Build Skills Instead" 提取内容并生成中文教程。

### 执行流程

1. **认证检查**：`notebooklm status` 确认认证有效
2. **创建 notebook**：`notebooklm create "AI品牌建设策略中文教程"`
3. **导入 source**：`notebooklm source add "https://www.youtube.com/watch?v=CEvIs9y1uog" -n <id>`
4. **确认 ready**：`notebooklm source list --json` 查看 source 状态
5. **多轮挖掘**：
   - Round 1: 获取整体大纲
   - Round 2-6: 逐章节深入（每轮一个主题）
6. **产出物组织**：`tutorial/README.md` + `tutorial/chapters/*.md`

### 产出物

完整中文教程（8 章）：`tutorial/`
- 从 Agent 范式转变到 Skills 生态系统全覆盖
- 含核心概念速览、计算类比、实战启示

### 踩坑记录

| 问题 | 解决 |
|------|------|
| `--json` 模式只返回 citations，看不到回答 | 挖掘阶段用文本模式（不加 `--json`） |
| 中文回答出现乱码 | 挖掘用英文提问，最终由编排层翻译 |
| ask 跑到错误的 notebook | 每个 ask 都显式加 `-n <notebook-id>` |
| 输出过长被截断 | 使用文件保存完整输出，避免依赖截断的终端输出 |

## 目录结构

```
use-notebooklm/
├── SKILL.md                     # 完整技能文档
├── README.md
├── scripts/
│   ├── cdp_login.py             # CDP 认证（核心）
│   ├── validate_notebooklm_request.js
│   └── validate_notebooklm_request.test.js
└── agents/
    └── openai.yaml
```
