import { FlatFile, Server } from 'boardgame.io/dist/cjs/server.js';
import path from 'path';
import { fileURLToPath } from 'url';
import serve from 'koa-static';
import { nanoid } from 'nanoid';
import { SanGuoSha } from '../lib/game.js';

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
    await next();
});

// Build path relative to the server.js file
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const frontEndAppBuildPath = path.resolve(__dirname, '../../build');
server.app.use(serve(frontEndAppBuildPath))

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
