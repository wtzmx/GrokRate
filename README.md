# Grok Rate Limit Monitor

![License](https://img.shields.io/badge/License-MIT-blue.svg)
![Version](https://img.shields.io/badge/Version-2.9-green.svg)
![Tampermonkey](https://img.shields.io/badge/Tampermonkey-Ready-orange.svg)

<div align="center">
  <img src="./images/logo.svg" alt="Grok Rate Limit Monitor Logo" width="120" height="120">
  <h3>实时监控 Grok API 使用限制和刷新倒计时</h3>
</div>

## 📋 功能概述

Grok Rate Limit Monitor 是一个用户脚本，为 Grok AI 平台提供实时 API 使用限制监控功能。这个工具可以帮助用户有效管理和跟踪他们的 Grok API 使用情况，避免超出使用限制。

### 主要特性

- 📊 **实时监控** - 实时追踪 Grok API 的使用情况和剩余配额
- 🔄 **倒计时刷新** - 显示剩余额度恢复倒计时
- 🧠 **多查询类型** - 分别监控普通、思考和深度研究三种查询类型
- 🎯 **直观界面** - 简洁美观的用户界面，清晰展示使用情况
- 🔒 **本地存储** - 在本地保存数据，确保信息持久化

## ⚙️ 使用方法

1. 安装一个用户脚本管理器（如 [Tampermonkey](https://www.tampermonkey.net/)）
2. 安装 Grok Rate Limit Monitor 脚本：
   - **方法 1**：点击 [这里](https://github.com/wangpeng1/GrokRate/raw/main/Grok%20Rate%20Limit%20Monitor-2.9.user.js) 直接安装
   - **方法 2**：访问 [Greasy Fork](https://greasyfork.org/scripts/XXXXX) 安装
   - **方法 3**：手动复制 [脚本代码](https://github.com/wangpeng1/GrokRate/blob/main/Grok%20Rate%20Limit%20Monitor-2.9.user.js) 到 Tampermonkey 中
3. 访问 [Grok 网站](https://grok.com/)
4. 监控面板将自动出现在页面右下角

## 🖥️ 界面功能

监控面板包含以下功能：

- **可拖拽** - 可以移动到任意位置
- **最小化/展开** - 可以折叠面板节省空间
- **关闭/恢复** - 可以完全隐藏面板，并通过右下角按钮重新显示
- **实时更新** - 自动捕获和更新 API 使用情况
- **进度条显示** - 直观展示剩余使用量的百分比

## 📈 监控数据说明

该脚本监控以下三种 Grok 查询类型的使用情况：

| 查询类型 | 说明 | 颜色标识 |
|---------|------|---------|
| 普通查询 | 标准 Grok 对话查询 | 🟢 绿色 |
| 思考查询 | 使用深度思考模式的查询 | 🟠 橙色 |
| 深度研究 | 深度搜索和研究类查询 | 🟣 紫色 |

针对每种查询类型，监控面板显示：
- 已用/总数查询量
- 剩余查询数
- 限制重置周期
- 剩余额度百分比
- 额度恢复倒计时（当额度用尽时）

## 🛠️ 技术实现

- 通过拦截 XHR 和 Fetch 请求捕获 API 使用数据
- 使用本地存储保存使用状态
- 实现了单一计时器管理多个倒计时显示
- 自适应进度条颜色反映使用情况（绿色-黄色-红色）
- 模块化的代码结构提高可维护性

## 🔍 更新日志

### 版本 2.9
- 优化了多查询类型的监控
- 改进了倒计时计算和显示
- 优化了界面设计和用户体验
- 修复了数据存储和加载问题
- 提高了性能和稳定性

## 📜 许可证

本项目采用 MIT 许可证授权。

## 🙏 贡献

欢迎提交问题和拉取请求，帮助改进这个工具！

---

<div align="center">
  <sub>Powered by Tampermonkey | Designed for Grok Users</sub>
</div>
