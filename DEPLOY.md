# 部署指南（跑团卡牌桌）

本项目是从 [kevinychen/sanguosha](https://github.com/kevinychen/sanguosha) 改造的
**跑团用网页版卡牌游戏**（类三国杀玩法 + GM 主持人模式），技术栈为
boardgame.io 0.43 + React 16。

## 功能一览

- **单房间 5 名玩家**：进入页面自动创建/加入唯一房间，5 个座位。
- **GM 模式**：旁观者（playerID `-1`），可以看到**所有玩家手牌**（牌面朝上）、
  所有玩家上传的图片与体力值；GM 无任何操作权限。
- **无武将牌**：每位玩家的"角色位"改为**自行上传图片**（自动压缩到 512px 以内，
  以 dataURL 存入游戏状态，所有玩家与 GM 可见，随对局持久化）。
- **只保留手牌玩法**：牌堆摸牌、打牌/弃牌、从弃牌堆捡牌、过河拆桥（弃他人手牌）、
  顺手牵羊（偷他人手牌）、轮流回合制（结束出牌 → 弃牌至 ≤ 体力值）、简单体力值调整。

## 本地运行

```bash
npm install          # 会自动执行 scripts/patch-boardgameio.mjs 打补丁
npm run server       # 启动服务器（默认 8098 端口）
```

打开 http://localhost:8098 即可游玩（服务器同时托管前端与游戏 API）。

> 开发模式：另开终端 `npm run client`（前端 dev server，代理到 8098）。

## 构建前端

Node 17+ 需要 OpenSSL legacy 标志（webpack 4）：

```bash
NODE_OPTIONS=--openssl-legacy-provider npm run build
# Windows PowerShell:
# $env:NODE_OPTIONS='--openssl-legacy-provider'; npm run build
```

产物在 `build/` 目录。

## 部署方案

### 方案 A：单一 Node 服务器（推荐，最省事）

前端构建产物由服务器自动托管（见 `src/server/server.js` 的 koa-static），
所以**只需要把一个 Node 服务跑起来**，前后端就都齐了。

- [Render](https://render.com) / [Railway](https://railway.app) / [Fly.io](https://fly.io) 免费层均可；
- 启动命令：`npm install && npm run server`（或 `node src/server/server.js`）；
- 设置环境变量 `PORT`（Render 等平台会自动注入）；
- 持久化：数据存于 `data/` 目录（node-persist FlatFile），
  需要挂载持久磁盘，否则重启会丢对局进度。

### 方案 B：前端上 GitHub Pages + 后端单独托管

1. 构建时指定后端地址：
   ```bash
   # Windows: $env:REACT_APP_PROXY='https://你的后端.onrender.com'
   REACT_APP_PROXY=https://你的后端.onrender.com npm run build
   ```
2. 把 `build/` 内容推送到 GitHub 仓库的 `gh-pages` 分支
   （仓库 Settings → Pages → 选择 gh-pages 分支），即可获得 `https://<用户名>.github.io/<仓库名>/`；
3. 后端按方案 A 部署在任意 Node 平台；
4. 服务器已默认开启 CORS（boardgame.io 内置 `@koa/cors`），跨域调用无问题。
   > 注意：GitHub Pages 上 WebSocket 由后端地址承载，与 Pages 域名无关，正常可用。

### 方案 C：纯局域网

在一台电脑上 `npm run server`，其他人用浏览器访问 `http://<这台电脑的内网IP>:8098`。
图片、对局状态都同步在这台机器上，最适合线下跑团。

## 架构与注意事项

- **游戏逻辑**：`src/lib/game.js`（moves：draw / play / pickUp / dismantle / steal /
  updateHealth / updateMaxHealth / setImage / endPlay / discardCard / finishDiscard），
  单阶段 `play` 自由模式 + 轮流回合制，无 `playerView`（所有客户端拿完整状态，GM 依赖此特性）。
- **客户端**：`src/client/`（lobby 单房间、gameArea 主界面、setModePanel 精简工具栏）。
- **boardgame.io 0.43 两个坑（已修）**：
  1. 客户端竞态：`update` 广播早于 `sync` 到达时 `store.getState()` 为 null 会崩溃 →
     `scripts/patch-boardgameio.mjs`（postinstall 自动执行，也可手动 `node scripts/patch-boardgameio.mjs`；
     若 `npm install --ignore-scripts` 请手动运行一次）。
  2. 旁观者认证：房间有凭据后，无凭据的 GM（旁观者）sync 会被默认认证拒绝 →
     `src/server/server.js` 传入 `authenticateCredentials: () => true`（朋友桌信任模式；
     GM 仍无操作权限，因为非玩家身份无法通过游戏流程校验）。
- **安全提示**：信任模式意味着知道房间地址的人都可以连接/加入，
  适合熟人桌；如需公网开放请自行加认证或访问控制。
- **数据持久化**：`data/` 目录保存对局（含上传图片），每周自动清理超过 7 天的对局。
