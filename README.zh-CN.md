<img src="assets/community-banner.png" alt="AI时代的学习和创作" width="680">

<table><tr><td width="180"><img src="assets/wechat.jpg" alt="微信交流二维码" width="156"></td><td>扫描二维码，加入终身学习者社群、交流群。<br>一起交流 AI、知识管理与效率工具。</td></tr></table>

---

# Roam Workspace

[English](README.md) | 简体中文

把日志、关联页面和近期活动放进同一个 Obsidian 工作区。本仓库已用本地当前集成版更新，源码基线为 `55818810dae2d28ca065843905a77436051258d8`（2026-10-09），替代旧的 Roam In Ob 快照。

## 功能

- **Journal**：连续编辑日记或文件夹笔记，支持日期范围、排序、预设及 Markdown 导出。
- **Page Stream**：把多个关联页面放在一起，用嵌入式 Markdown 编辑器编辑。
- **Navigation**：集中查看近期文件、近期任务和筛选条件。
- **List Heading 与 Outliner**：紧凑的大纲导航和限定范围的列表编辑。

## 安装

从 [0.1.0 发布页](https://github.com/PkuLilBoat/roam-workspace/releases/tag/0.1.0) 下载 `main.js`、`manifest.json`、`styles.css`，直接放进 `<库>/<配置目录>/plugins/roam-workspace/`，配置目录通常是 `.obsidian`。重载 Obsidian，必要时允许使用第三方插件，在设置中启用 **Roam Workspace**。源码 ZIP 不包含 `main.js`。

更新前备份原插件文件夹并保留 `data.json`。插件 ID 是 `roam-workspace`；旧的 `roam-in-ob` 和 Daily Notes Editor 是不同安装。兼容性排查时可关闭功能重叠的插件，不要自动删除或迁移它们的数据。

当前是供手动安装的开发快照，尚未进入 Obsidian 官方社区目录。manifest 声明最低版本 1.8.7、非仅桌面，但本次未独立完成最低版本及移动端兼容矩阵验证，建议先在测试库试用。

## 使用与设置

在命令面板执行 **Roam Workspace: Open journal stream**、**Open page stream**、**Open roam navigation** 或 **Open list heading**。先在插件设置中选择日记文件夹，默认是 `Journal`。设置还包括启动行为、日期范围、预设、来源路径、frontmatter、反向链接、导航筛选、近期任务及 Outliner 作用范围；近期任务默认关闭。

## 隐私与 AI

笔记和插件设置保存在本地库。本插件不内置 AI 服务、AI 账号或 MCP。外部本地 AI 助手可以协助安装三个文件、编辑配置；其权限与隐私政策另行适用。发布包不包含个人 `data.json`、笔记和本地多库部署目标。公开副本的部署清单为空；安装者不要运行作者的多库部署脚本。

## 开发

```sh
pnpm install --frozen-lockfile
pnpm run build
pnpm run test:journal
pnpm run test:compat-quality
pnpm run test:navigation
pnpm run lint
```

`build` 包含 Svelte/TypeScript 检查，并生成 `main.js`、`styles.css` 与构建指纹。实际检查结果见发布说明。运行时审计脚本绑定维护者本地 TEST 库，不是通用安装命令。

## 来源与许可

源自 [Daily Notes Editor](https://github.com/Quorafind/Obsidian-Daily-Notes-Editor)，嵌入式编辑器部分源自 [Hover Editor](https://github.com/nothingislost/obsidian-hover-editor)。详见[第三方声明](THIRD_PARTY_NOTICES.md)与[历史 README](docs/UPSTREAM-README.md)。

旧仓库记录的 Daily Notes Editor 继承代码根许可尚未解决，本次保留该状态，不把整个项目重新声明为 MIT，也不声称已厘清继承代码分发权限。Outliner 保留其独立 MIT 许可及声明。本次开发快照发布不代表官方目录审核或生产可用性验收。

## 反馈

欢迎通过 [GitHub Issues](https://github.com/PkuLilBoat/roam-workspace/issues) 反馈问题或建议。
