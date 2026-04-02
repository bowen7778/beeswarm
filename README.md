# BeeSwarm Kernel

基于 Model Context Protocol (MCP) 的工业级服务端核心。

## 架构规范
- **主程序**：存放于 `src/`, `ui/`, `src-tauri/`。
- **发布流程**：采用单仓双分支模型 (`main` -> `stable`)。
- **热更新**：通过 GitHub Releases 自动化分发 `kernel.tar.gz`。

## 开发者指南
- 日常开发：推送到 `main` 分支。
- 正式发布：执行 `node scripts/release.mjs --version X.Y.Z --push`。
