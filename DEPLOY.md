# 公网部署指南（Zeabur 国内方案 · 当前推荐）

让小伙伴通过公网访问你的"跑团卡牌桌"。**当前推荐用 Zeabur 一站部署**
（国内团队 PaaS，支持支付宝/微信付款，有免费方案；整个游戏前后端放一个服务）。

## 架构

```
小伙伴的浏览器
   │  打开
   ▼
Zeabur 服务（https://xxx.zeabur.app/）
   └─ 一个容器同时托管：前端页面（build/）+ Node 游戏服务器（WebSocket）
```

前后端同源，无需跨域配置，**也不用 GitHub Pages**。

---

## 部署步骤（Zeabur，约 15 分钟）

### 1. 注册并登录 Zeabur

打开 https://zeabur.com → 注册（支持邮箱 / GitHub 账号）。新用户选 **Free 免费方案** 即可。

### 2. 创建项目并关联 GitHub 仓库

1. 控制台 → **创建项目**（Project）
2. 项目里点 **部署新服务** → 选 **从 GitHub 导入**（Git 来源）
3. 授权 Zeabur 访问 GitHub → 选择仓库 **`lijiapenggg/sanguosha`**（仓库必须是 public 或已授权）

### 3. 自动构建并部署

Zeabur 会自动读取仓库根目录的 **`zbpack.json`**（已配好构建/启动命令）：

- 安装依赖（自动执行 boardgame.io 补丁脚本）
- 构建前端：`NODE_OPTIONS=--openssl-legacy-provider npm run build`
- 启动游戏服务器：`npm run server`（监听平台注入的 `$PORT`，默认 8080）

等 2~4 分钟部署完成。

### 4. 绑定域名

1. 展开服务 → **域名（Domains）** 区块
2. 点 **生成域名** → 得到一个 `https://xxx.zeabur.app` 网址（也可绑定自己的域名）

### 5. 测试

浏览器打开 `https://xxx.zeabur.app`，多开几个窗口进游戏（注意别用"复制标签页"）。
让 5 个小伙伴同时打开 → 各占座位 → 第 6 人当 GM。

> 如果在国内访问较慢，可在创建项目/服务时留意运行环境是否可选**就近节点**；
> 免费方案若有每月流量/时长限制，用量上来后在控制台升级 Dev 方案（约 ¥5-9/月）。

### 6. （可选）持久化对局数据

对局数据（含玩家上传的图片）存服务内 `data/` 目录。免费方案容器重建会重置数据；
如需持久化，给服务挂载一个 **Volume** 并映射到 `data/` 路径。

---

## 代码已为 Zeabur 做好的适配

- `zbpack.json`：显式指定构建/启动命令（否则默认 `npm start` 会跑成开发模式）
- `src/server/server.js`：`PORT = process.env.PORT || 8098`（本地默认 8098，平台注入时跟随）
- `package.json`：`server` 脚本不再写死端口

---

## 附录：其他方案（备选）

### 方案 A：国内云服务器 VPS（腾讯云轻量 / 阿里云活动机，约 ¥38-99/年）

整站放一台机器上，`IP:8098` 访问免备案。需要 SSH 装 Node 环境，运维稍多。
详见仓库根目录 README 的本地启动方式，部署命令：
```bash
npm install && NODE_OPTIONS=--openssl-legacy-provider npm run build && npm run server
```

### 方案 B：家用台式机 + Cloudflare Tunnel（0 元）

本机 `npm run server` + `cloudflared tunnel --url http://localhost:8098`，
临时网址发群里即可；电脑需保持开机。

### 方案 C：GitHub Pages + Render（早期方案，已弃用）

Render 免费层需国际信用卡、国内访问不稳定，不再推荐。相关文件（render.yaml、
`.github/workflows/deploy-pages.yml`）保留在仓库中，如需 GitHub Pages 展示页可参考
`git log` 历史说明。
