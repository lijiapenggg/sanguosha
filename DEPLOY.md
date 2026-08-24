# 公网部署指南（GitHub Pages + Render 免费后端）

让小伙伴通过公网访问你的"跑团卡牌桌"。

## 架构说明（先看懂再动手）

这个游戏需要一个 **Node.js 游戏服务器**（WebSocket 实时同步对局状态），而
**GitHub Pages 只能托管静态网页、不能运行服务器**。所以拆成两部分：

```
小伙伴的浏览器
   │  ①打开
   ▼
GitHub Pages（https://<你的名字>.github.io/<仓库名>/）
   │  ②页面里的游戏客户端自动连接
   ▼
Render 免费后端（https://xxx.onrender.com/）
      └─ 跑 Node 游戏服务器，实时同步手牌/体力/图片
```

- **GitHub**：托管代码仓库 + 前端页面（免费、永久、github.io 域名）
- **Render**：托管游戏服务器（免费层，官方支持 WebSocket，**有人在线时不会休眠**；
  15 分钟无人访问才会休眠，唤醒约需 1 分钟）

> 💡 最快路径：如果只想让小伙伴马上能玩，**第 1、2 步做完**后直接把 Render 的网址
> `https://xxx.onrender.com` 发给他们就行（Render 上前后端在一起，一样能玩）。
> 第 3 步的 GitHub Pages 是为了拿到 `<你的名字>.github.io` 域名。

---

## 第 0 步：准备账号（约 5 分钟）

1. 注册 **GitHub 账号**：https://github.com/signup （没有的话）
2. 注册 **Render 账号**：https://render.com → Sign up（用 GitHub 账号一键登录最快）

---

## 第 1 步：把代码推到 GitHub（约 10 分钟）

在电脑上打开 PowerShell，进入项目目录：

```powershell
cd D:\Dsh-Workspace\sanguosha-kevin
```

### 方式 A：用 GitHub CLI（推荐，命令最省事）

1. 安装 GitHub CLI：
   ```powershell
   winget install GitHub.cli
   ```
   （装完后**关掉并重新打开 PowerShell**）

2. 登录（会弹出浏览器，点 Authorize 即可）：
   ```powershell
   gh auth login
   ```

3. 把本地分支改名为 main 并推送到新仓库（把 `sanguosha` 换成你想要的仓库名）：
   ```powershell
   git branch -M main
   gh repo create sanguosha --public --source . --push
   ```

### 方式 B：纯浏览器操作

1. 打开 https://github.com/new → 仓库名填 `sanguosha` → **Public** → Create repository
2. 在 GitHub 仓库页复制"…or push an existing repository"下的三行命令（HTTPS 方式），
   回到 PowerShell 依次粘贴执行。推送前先改名：
   ```powershell
   git branch -M main
   ```

> 推送如果提示输入用户名/密码，用 https://github.com/settings/tokens 生成的
> **Personal access token**（勾选 repo 权限）作为密码。

---

## 第 2 步：在 Render 部署游戏服务器（约 5 分钟）

1. 登录 https://dashboard.render.com
2. 点 **New +** → **Web Service**
3. **Connect a repository** → 选刚才的 `sanguosha` 仓库
   （首次需要 Install Render on GitHub，按提示授权）
4. Render 会自动读取仓库里的 **`render.yaml`**，服务名/启动命令等都填好了，
   直接点 **Create Web Service**
5. 等待几分钟部署完成，页面显示 **`Your service is live 🎉`**，网址形如
   `https://sanguosha-server.onrender.com`
6. **立即测试**：浏览器打开这个网址，多开几个窗口，确认能正常进游戏

> 到这里，把 `https://sanguosha-server.onrender.com` 发给小伙伴，他们已经能玩了。
> 继续做第 3 步可获得 github.io 域名。

---

## 第 3 步：配置 GitHub Pages（约 5 分钟）

### 3.1 告诉前端"后端在哪"

1. 打开你的 GitHub 仓库 → **Settings** → 左侧 **Secrets and variables** → **Actions**
2. 切到 **Variables** 标签 → **New repository variable**
   - Name：`BACKEND_URL`
   - Value：`https://sanguosha-server.onrender.com`（第 2 步的网址，**去掉末尾斜杠**）
   - 保存

### 3.2 开启 GitHub Pages（来源选 GitHub Actions）

1. 仓库 **Settings** → 左侧 **Pages**
2. **Source** 选 **GitHub Actions**
3. （无需手动选分支，工作流会自动发布）

### 3.3 运行部署工作流

1. 仓库顶部 **Actions** 标签页
2. 左侧选 **"部署前端到 GitHub Pages"** → 右侧 **Run workflow** → 绿色按钮
3. 等两个任务（build / deploy）跑完变绿（约 2~3 分钟）
4. 完成后仓库 **Settings → Pages** 页会显示你的网址：
   `https://<你的GitHub名字>.github.io/sanguosha/`

### 3.4 最终测试

- 浏览器打开 `https://<你的GitHub名字>.github.io/sanguosha/`
- 多开几个窗口进游戏（注意：不要用"复制标签页"）
- 按 `F12` → Network 标签，确认有发往 `https://sanguosha-server.onrender.com` 的
  WebSocket 连接（说明页面成功连上了后端）
- 让 5 个朋友同时打开网址 → 各占一个座位 → 第 6 个人当 GM

---

## 验证与常见问题

| 现象 | 处理 |
|---|---|
| 页面打开但进不了房间 | 等 1 分钟（Render 免费层休眠后唤醒需要时间）；确认 `BACKEND_URL` 变量已设置且工作流重新跑过 |
| 改了游戏代码 | 推到 `main` 分支会自动重新构建部署（工作流监听 push）；后端 Render 也会自动重部署 |
| Render 重启后进度/图片丢失 | 免费层无持久磁盘，正常现象（对局数据存 `data/` 目录）；想持久化可升级付费盘，或换家用机方案（见附录） |
| 想换域名/仓库名 | 修改 `BACKEND_URL` 变量并重跑工作流即可 |

## 附录：Plan B —— 家用台式机 + Cloudflare Tunnel（零云端依赖）

如果不想注册 Render，也可以用家里的台式机当服务器：

1. 本机运行 `npm run server`（保持开机、不关窗口）
2. 安装 [cloudflared](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/)
   并执行：
   ```powershell
   cloudflared tunnel --url http://localhost:8098
   ```
3. 终端会输出一个 `https://xxx.trycloudflare.com` 临时网址，发给小伙伴即可访问
   （电脑关机/网址重启后会变，可注册 Cloudflare 账号用固定隧道名解决）

---

## 我（AI）已经自动完成的部分

- `package.json`：加了 `"homepage": "."`（相对路径，Pages 子路径部署必需，已实测构建产物）
- `render.yaml`：Render 自动部署配置（Node 环境、构建/启动命令、健康检查、OpenSSL 兼容变量）
- `.github/workflows/deploy-pages.yml`：推送即自动构建前端并发布到 GitHub Pages
  （读 `BACKEND_URL` 仓库变量指向后端）
- 本部署文档；全部改动已 git 提交

你只需要手动完成：注册账号（第 0 步）→ 推送代码（第 1 步）→ Render 点几下（第 2 步）
→ 填一个变量 + 开 Pages + 点一次 Run workflow（第 3 步）。
