import { FlatFile, Server } from 'boardgame.io/dist/cjs/server.js';
import path from 'path';
import { fileURLToPath } from 'url';
import serve from 'koa-static';
import koaBody from 'koa-body';
import fs from 'fs';
import { nanoid } from 'nanoid';
import { SanGuoSha } from '../lib/game.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// 上传目录放在 data/ 之外（node-persist 会扫描 data/，子目录会导致 EISDIR）
const uploadsDir = path.resolve(__dirname, '../../uploads');

const db = new FlatFile({ dir: 'data' });

// 信任所有连接（朋友桌模式）：
// boardgame.io 默认在房间有凭据后要求校验，旁观者（GM）没有凭据会被拒绝同步。
// 这里放行所有人；GM 仍无法执行操作（非玩家身份不会被游戏流程允许）。
const server = Server({
    games: [SanGuoSha],
    db,
    authenticateCredentials: () => true,
});
// 端口：优先用平台注入的 $PORT（Zeabur/Render 等），本地默认 8098
const PORT = process.env.PORT || 8098;

// 按房间串行化关键区：boardgame.io 0.43 的 join 路由没有并发保护，
// 多窗口同时加入会"丢更新"（后写覆盖先写）或误报 409。这里把"读-改-写"串行化。
const matchQueues = new Map();
function runExclusive(matchID, fn) {
    const key = String(matchID);
    const prev = matchQueues.get(key) || Promise.resolve();
    let release;
    const gate = new Promise(res => { release = res; });
    const tail = prev.catch(() => { }).then(() => fn()).finally(() => release());
    matchQueues.set(key, prev.catch(() => { }).then(() => gate));
    return tail;
}

// 自定义接口（需在 koa-static 之前注册）
server.app.use(async (ctx, next) => {
    // 加入座位：与 boardgame.io 的 join 等价，但按房间串行、避免并发竞态
    if (ctx.method === 'POST' && ctx.path === '/api/join') {
        const { matchID, playerID, playerName } = ctx.query;
        if (!matchID || playerID === undefined || playerID === null || !playerName) {
            ctx.status = 400;
            ctx.body = { error: '缺少参数' };
            return;
        }
        const result = await runExclusive(matchID, async () => {
            const { metadata } = await db.fetch(matchID, { metadata: true });
            if (!metadata) {
                return { status: 404, error: '房间不存在' };
            }
            const player = metadata.players[playerID];
            if (!player) {
                return { status: 404, error: '座位不存在' };
            }
            if (player.name) {
                return { status: 409, error: '该座位已被占用' };
            }
            player.name = playerName;
            player.credentials = nanoid();
            await db.setMetadata(matchID, metadata);
            return { status: 200, playerCredentials: player.credentials };
        });
        ctx.status = result.status;
        ctx.body = result;
        return;
    }
    // GM 清空玩家：释放所有座位（名字/凭据清除），对局状态不变
    if (ctx.method === 'POST' && ctx.path === '/api/gm/clear-players') {
        const { matchID } = ctx.query;
        if (!matchID) {
            ctx.status = 400;
            ctx.body = { error: '缺少 matchID' };
            return;
        }
        const result = await runExclusive(matchID, async () => {
            try {
                const { metadata } = await db.fetch(matchID, { metadata: true });
                if (!metadata) {
                    return { status: 404, error: '房间不存在' };
                }
                if (!metadata.players) {
                    return { status: 500, error: 'metadata.players 缺失' };
                }
                for (const player of Object.values(metadata.players)) {
                    if (player) {
                        delete player.name;
                        delete player.credentials;
                        player.isConnected = false;
                    }
                }
                await db.setMetadata(matchID, metadata);
                return { status: 200, ok: true };
            } catch (e) {
                return { status: 500, error: e.message || String(e) };
            }
        });
        ctx.status = result.status;
        ctx.body = result;
        return;
    }
    // 上传玩家图片：存到 data/uploads/，返回静态 URL（避免 base64 图片随每次广播重发，挤占带宽）
    if (ctx.method === 'POST' && ctx.path === '/api/upload') {
        return koaBody({
            multipart: true,
            formidable: { maxFileSize: 3 * 1024 * 1024 },
        })(ctx, async () => {
            try {
                const file = ctx.request.files && ctx.request.files.image;
                // formidable 1.x 用 file.path，2.x 用 file.filepath，兼容两者
                const tmpPath = file && (file.path || file.filepath);
                const { matchID, playerID } = ctx.request.body || {};
                if (!file || !tmpPath || !matchID || playerID === undefined) {
                    ctx.status = 400;
                    ctx.body = { error: '缺少文件或参数' };
                    return;
                }
                const filename = `${matchID}-${playerID}-${Date.now()}-${nanoid(6)}.jpg`;
                fs.mkdirSync(uploadsDir, { recursive: true });
                const dest = path.join(uploadsDir, filename);
                // 跨盘符不能 rename（formidable 临时文件在系统 Temp），用复制+删除
                fs.copyFileSync(tmpPath, dest);
                try {
                    fs.unlinkSync(tmpPath);
                } catch (e) {
                    // 临时文件清理失败可忽略
                }
                ctx.body = { url: `/uploads/${filename}` };
            } catch (e) {
                ctx.status = 500;
                ctx.body = { error: `上传失败: ${e.message || String(e)}` };
            }
        });
    }
    await next();
});

const frontEndAppBuildPath = path.resolve(__dirname, '../../build');
server.app.use(serve(frontEndAppBuildPath))
// 上传的玩家图片静态服务
server.app.use(serve(uploadsDir, { prefix: '/uploads' }))

server.run(PORT, () => {
    server.app.use(
        async (ctx, next) => await serve(frontEndAppBuildPath)(
            Object.assign(ctx, { path: 'index.html' }),
            next
        )
    )
});

// Clean up old matches
const week = 7 * 24 * 60 * 60 * 1000;
setInterval(() => {
    db.listMatches({ where: { updatedBefore: Date.now() - week } }).then(matchIDs => {
        for (const matchID of matchIDs) {
            db.wipe(matchID);
        }
    });
}, week);

// 孤儿上传图片清理：玩家离开房间/离线超 1 小时后，其上传的图片如未被任何房间引用则删除
const ORPHAN_IMAGE_TTL = 60 * 60 * 1000; // 1 小时
async function cleanupOrphanUploads() {
    try {
        if (!fs.existsSync(uploadsDir)) {
            return;
        }
        // 收集所有房间当前仍在引用的图片 URL
        const referenced = new Set();
        try {
            const matchIDs = await db.listMatches();
            for (const matchID of matchIDs) {
                try {
                    const { state } = await db.fetch(matchID);
                    const images = state && state.G && state.G.playerImages;
                    if (images) {
                        for (const url of Object.values(images)) {
                            if (typeof url === 'string' && url.startsWith('/uploads/')) {
                                referenced.add(url);
                            }
                        }
                    }
                } catch (e) {
                    // 单个房间读取失败不影响清理
                }
            }
        } catch (e) {
            // listMatches 失败则跳过本次清理
        }
        const now = Date.now();
        const files = fs.readdirSync(uploadsDir);
        for (const name of files) {
            if (referenced.has(`/uploads/${name}`)) {
                continue; // 仍被引用，保留
            }
            const full = path.join(uploadsDir, name);
            try {
                const stat = fs.statSync(full);
                if (now - stat.mtimeMs > ORPHAN_IMAGE_TTL) {
                    fs.unlinkSync(full);
                }
            } catch (e) {
                // 单文件删除失败可忽略
            }
        }
    } catch (e) {
        // 清理失败不影响服务器运行
    }
}
// 每 10 分钟清理一次
setInterval(cleanupOrphanUploads, 10 * 60 * 1000);
// 启动时先跑一次
setTimeout(cleanupOrphanUploads, 60 * 1000);
