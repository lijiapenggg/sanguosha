import { FlatFile, Server } from 'boardgame.io/dist/cjs/server.js';
import path from 'path';
import { fileURLToPath } from 'url';
import serve from 'koa-static';
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
