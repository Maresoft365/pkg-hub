## ⚠️ Disclaimer / 免责声明
This project is an **unofficial, third-party graphical user interface (GUI) client** for the Microsoft Winget package manager.
- It is **not officially affiliated with, endorsed by, or supported by Microsoft Corporation.**
- “Winget” is a registered trademark of Microsoft Corporation. This project’s use of the term is purely for descriptive purposes to indicate compatibility.
- This software simply invokes the official `winget` command-line tool provided by Microsoft. All software packages are sourced from the official Winget repositories or the Microsoft Store.


PkgHub - 让 Windows 7 也能享受现代软件管理
基于 Electron 19（Chromium 102）

## 已知问题
- 在某些情况下，代码会神奇地工作
- 在其他情况下，代码会神奇地不工作
- 重启可以解决90%的问题

# PkgHub 🚀
一款基于 Electron 开发的 WinGet 图形界面工具，告别命令行，一键搜索/安装 Windows 软件！

## 👨‍💻 开发者信息
- 开发者：Maresoft
- 开发时间：2026年
- 技术栈：Electron + HTML + CSS + JavaScript
- 许可证：MIT License（详见 LICENSE 文件）

## ✨ 核心功能
1. **可视化搜索**：输入软件名称，一键搜索 WinGet 软件库中的资源，无需记忆命令；(一个winget install的事想记的早记住了吧doge)
2. **丝滑加载动画**：搜索过程中显示旋转加载动画（🔄），提升使用体验；
3. **智能错误提示**：搜索不到软件时给出友好提示，避免命令行报错的晦涩信息；
4. **管理员权限**：自动申请管理员权限，适配 WinGet 运行的权限要求；

## 📥 安装与使用
### 安装方式
1. 下载项目打包后的 `PkgHub Setup 1.0.0.exe` 安装包；
2. 双击运行安装包，可自定义安装路径（推荐存放在数据盘）；
3. 安装完成后，桌面会生成快捷方式，双击即可启动。

### 使用步骤
1. 启动 PkgHub（首次运行会申请管理员权限，点击“是”即可）；
2. 在搜索框输入软件名称（如 `Chrome`、`VS Code`）；
3. 点击“搜索”按钮，等待加载完成即可查看结果；

## 🛠️ 开发说明
### 本地运行项目
```bash
# 克隆/下载项目后，进入项目目录
npm install  # 安装依赖
npm start    # 启动开发版

## 📜 许可证

本项目采用 **Commons Clause + Apache 2.0** 许可证。

### ✅ 您可以：
- 查看、下载、使用源代码
- 修改源代码
- 私有部署和使用（个人或公司内部）
- 作为更大项目的一部分使用（如果不收费）
- 用于学习、研究、开发

### ❌  您无权：（需要商业授权）：
- **销售本软件**或基于本软件的衍生产品
- **将本软件作为服务销售**（SaaS）
- **在商业产品中集成并转售**
- **收取与本软件功能直接相关的费用**

### 💼 商业授权：
如果您需要将本软件用于商业目的，请联系获取商业许可证：
- 邮箱：Maresoft@yeah.net
- 价格：根据使用规模和需求定制

### 📖 完整许可证：
详见 [LICENSE](LICENSE) 文件