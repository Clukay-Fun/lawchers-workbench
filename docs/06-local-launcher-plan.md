# 开发计划 06 · 本地启动器（双击安装 + 双击启动）

> 目标：**macOS 普通用户双击安装 + 双击启动**，不手输 npm/pip。Windows 只给 **best-effort 脚手架（未实测）**，不承诺支持。
> 不打 Electron（三阶段）、不做 Release 离线包（二阶段）；本阶段 = 第一阶段。
> **依赖**：建立在 docs/05（引擎安装 / CLI resolver / setup 底座）之上，docs/05 须先落地。

---

## 一、macOS（本阶段做透、真实验收）

### 1.1 双击入口
- `安装 LAWCHERS.command` → 调 `scripts/setup-app.sh`
- `启动 LAWCHERS.command` → 调 `scripts/start-app.sh`
- 两个 `.command` 加可执行权限；README 写明首次双击若被 Gatekeeper 拦，需**右键→打开**一次（未签名）。

### 1.2 `scripts/setup-app.sh`（一键安装，断点续装）
编排：
1. 检查 Node（缺则提示安装，给出指引）。
2. `npm install`（可配置 registry，见 1.5）。
3. 引擎安装：复用 docs/05 的 `setup-engine.sh`（建 `.venv`、pip 装 `legal-desens[pdf,ocr]` pin commit）。
4. NER 模型：缓存 + SHA 校验（见 1.4）。
5. 初始化 SQLite。
6. `npm run build`（产出 `frontend/dist`）。
7. 自检 `legal-desens`（version + 一次 prepare 烟雾测试）。
8. 打印「安装完成，请双击 启动 LAWCHERS.command」。

**断点续装**（任一步已完成则跳过，失败后再次双击从缺失步骤继续）：
- `node_modules/` 存在 → 跳过 `npm install`
- `.venv` 存在且 `legal-desens` 可用 → 跳过引擎安装
- 模型存在且 SHA 正确 → 跳过下载
- `frontend/dist` 存在 → 跳过 build

### 1.3 `scripts/start-app.sh`（单服务启动）
- **只起 backend**；backend 托管 `frontend/dist`（静态）+ `/api` 同端口。
- 端口 `APP_PORT`（默认 **3000**，可配）。
- 启动后自动打开浏览器 `http://localhost:3000`。
- **前台运行**：关闭终端即停止服务（满足验收 #8）。

### 1.4 模型缓存 + SHA 校验
查找优先级：
1. `assets/models/`（项目内缓存）
2. `~/.legal-desens/models/`
3. 远程下载（下载后 **SHA 校验**，失败重试/报错，不静默）
> 后续（二阶段）可把模型 zip 放 GitHub Release，避免每次从 ModelScope 拉。

### 1.5 npm registry 可配置
- **不改用户全局配置**；只在本项目安装命令临时用：`npm install --registry=<镜像>`。
- 提供环境变量/参数切换镜像（默认官方源，国内可切 `https://registry.npmmirror.com`）。

### 1.6 单服务的同源 API（必做，否则 dist 仍打 3001）
- 生产构建时前端 API 基址改为**同源相对**（`VITE_API_BASE` 设为 `''` 或 `/api`），使 `frontend/dist` 调用 `http://localhost:3000/api` 同端口，而非写死 3001。
- backend 增加：生产模式 `express.static('frontend/dist')` + SPA 回退（见 1.7 顺序）。

### 1.7 执行防坑（三个必须钉死的点）
1. **端口统一**：后端实际读 `process.env.PORT || 3001`（`backend/src/index.js:24`）。`start-app.sh` 对用户暴露 `APP_PORT`，但**启动 backend 时必须导出 `PORT=${APP_PORT:-3000}`**，否则会出现"启动器开 3000、后端跑 3001"。
2. **前端写死 3001 不止一处**：生产 dist 中**任何地方都不得写死 `localhost:3001`**，至少两处要改成同源：
   - `frontend/src/api.js:11` 的 `API_BASE`（`VITE_API_BASE || 'http://localhost:3001/api'`）
   - `frontend/src/App.jsx:107` 的 `backendOrigin`（`VITE_BACKEND_ORIGIN || …:3001`，用于 uploads / 文件预览 URL）
   - 生产模式两者统一走**同源**（相对 `/api`、`/uploads` 或空 origin）。
3. **SPA fallback 顺序写死**：必须是
   ```
   /api      → routes
   /uploads  → static uploads（已挂在 index.js:41）
   frontend/dist 静态
   其余「非 /api、非 /uploads 的普通 GET」 → index.html
   ```
   SPA 回退**必须排在 `/api` 和 `/uploads` 之后**，且只处理页面路由 GET——否则会把 `/api` 请求或上传文件预览回退成 `index.html` 打坏。

---

## 二、Windows（best-effort 脚手架，**未实测**）
- 仅产出：`安装 LAWCHERS.bat` / `启动 LAWCHERS.bat` → `scripts/setup-app.ps1` / `scripts/start-app.ps1`（PowerShell 端口对应 `.venv/Scripts/legal-desens.exe`）。
- **文件头注释 + README 必须写**：
  ```
  Windows support is best-effort and has not been verified on a Windows machine.
  ```
- **不得**写"Windows 已支持"；不纳入已支持平台清单。

---

## 三、验收

### macOS（必须真跑并贴证据）
1. 删除 `node_modules`、`.venv`、`frontend/dist`。
2. 双击 `安装 LAWCHERS.command`。
3. 安装完成，**无需手输 npm/pip**。
4. 双击 `启动 LAWCHERS.command`。
5. 浏览器自动打开。
6. 上传 DOCX → prepare 成功。
7. 导出 DOCX → residual passed。
8. 关闭终端后服务停止。
9. 再次双击启动，不重复安装（断点续装生效）。

### Windows（只能这样写）
- 脚本语法/路径设计检查通过。
- README 标注未实测。
- **不纳入已支持平台**。

---

## 四、约束
- **验证铁律**：macOS 验收必须真跑 1–9 并贴真实输出（安装日志、自动打开、DOCX prepare/导出 residual passed、关终端停、再启不重装）；禁止只 build/lint 充验证。Windows 不得用"应该能跑"当证据。
- Conventional Commits、原子提交、当前分支、不 push。
- 只动本仓库；不回退 docs/05 的 resolver/setup 与已完成功能。
- 不打 Electron、不做 Release 离线包（本阶段排除）。
