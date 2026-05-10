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

# 3. 渐进式提问
notebooklm ask "Break down this video into chapters" -n "<id>"

# 4. 生成产物
notebooklm generate audio -n "<id>"
notebooklm download audio -n "<id>"
```

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
