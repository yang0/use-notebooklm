# 不要造Agent，造Skill——Anthropic最新演讲深度解析

> **原文**: Don't Build Agents, Build Skills Instead  
> **演讲者**: Barry Zhang & Mahesh Murag (Anthropic)  
> **来源**: [YouTube](https://www.youtube.com/watch?v=CEvIs9y1uog)

---

## 教程简介

这篇教程是对 Anthropic 两位核心成员 Barry Zhang 和 Mahesh Murag 在最新演讲中提出的 **"Skills"** 概念的完整中文解读。

演讲的核心论点是：**Agent 的底层架构远比我们想象得更通用，真正的差异化不在于重新造轮子，而在于给通用 Agent 注入领域专业知识——这就是 Skill。**

本教程将带你系统理解：
- 为什么当前 Agent "聪明但不专业"
- Skill 是什么、长什么样、怎么工作
- Skills 生态系统的三种类型和实际案例
- 现代 Agent 架构的四层堆栈
- Skills 如何成为 AI 时代的"应用程序"

---

## 章节目录

| 章节 | 标题 | 内容概要 |
|------|------|----------|
| [ch01](./chapters/ch01-引言与新范式.md) | 引言：Agent的新范式 | 从"造Agent"到"造Skill"的转变 |
| [ch02](./chapters/ch02-智能不等于专业.md) | 智能不等于专业 | The Brilliance Gap：Agent的致命短板 |
| [ch03](./chapters/ch03-什么是Agent-Skill.md) | 什么是 Agent Skill | Skill的定义、格式、渐进式披露机制 |
| [ch04](./chapters/ch04-Scripts作为Tools.md) | Scripts 作为 Tools | 为什么脚本比传统AI Tool更好 |
| [ch05](./chapters/ch05-Skills生态系统.md) | Skills 生态系统 | 三类Skill：基础型、第三方、企业/团队 |
| [ch06](./chapters/ch06-现代Agent架构.md) | 现代 Agent 架构 | 四层堆栈：Loop + Runtime + MCP + Skills |
| [ch07](./chapters/ch07-Skills作为软件.md) | Skills 作为软件 | 未来方向：测试、版本、依赖、分发 |
| [ch08](./chapters/ch08-集体组织记忆.md) | 集体组织记忆 | Skills如何让Agent越用越聪明 |

---

## 核心概念速览

### 一句话总结
> **Skill = 为通用Agent打包的领域专业知识文件夹**

### 关键对比

| 维度 | 传统做法 | Skills范式 |
|------|----------|------------|
| 开发方式 | 为每个场景造新Agent | 给同一个Agent装不同Skill |
| 专业知识 | 每次从零推导 | 打包成可复用的文件夹 |
| 学习能力 | 不会学习，每次重新开始 | 可积累、可传递 |
| 创建者 | 只有开发者 | 任何人（包括非技术人员） |
| 工具形态 | 传统Tool（指令模糊、不可修改） | Script（自文档、可修改、存文件系统） |

### 计算类比

演讲者用这个类比来理解整个Agent技术栈：

- **模型 (Models)** = **处理器 (Processors)** —— 需要巨额投资，蕴含巨大潜力，但本身用途有限
- **Agent运行时 (Agent Runtimes)** = **操作系统 (OS)** —— 编排资源、进程和数据，让处理器更有价值
- **Skills** = **应用程序 (Applications)** —— 解决具体问题，编码领域专业知识

---

## 为什么这篇演讲重要

1. **来自源头**: Barry Zhang 和 Mahesh Murag 是 Claude Skills 的创造者，不是观察者
2. **刚发布5周**: 演讲时 Skills 刚推出5周，已有数千个Skill，这个增长速度非常惊人
3. **解决真问题**: 当前Agent"能做很多事，但做不好任何事"的痛点被精准击中
4. **面向未来**: 提出了"Agent + MCP + Skills"这一标准化架构，影响整个行业

---

*本教程通过 NotebookLM 渐进式多轮提取生成，基于原始演讲视频内容。*
