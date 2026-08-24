/**
 * 远程只读验证：连接 Zeabur 部署的服务器，以 GM 旁观者身份同步现有房间，
 * 检查新代码（GM stage / playerImages / healths 结构）是否已生效。
 * 全程只读，不创建房间、不做任何移动。
 */
import { Client } from 'boardgame.io/dist/cjs/client.js';
import { SocketIO } from 'boardgame.io/dist/cjs/multiplayer.js';
import { SanGuoSha } from '../src/lib/game.js';

const SERVER = 'https://sanguo.zeabur.app';
const sleep = ms => new Promise(r => setTimeout(r, ms));

let failures = 0;
function check(name, cond, detail) {
    if (cond) {
        console.log(`  ✓ ${name}`);
    } else {
        failures++;
        console.log(`  ✗ ${name} ${detail !== undefined ? JSON.stringify(detail) : ''}`);
    }
}

// 1. 获取现有房间
console.log('== 1. 现有房间 ==');
const apiRes = await fetch(`${SERVER}/games/san-guo-sha`);
const api = await apiRes.json();
check('游戏 API 可用', apiRes.status === 200);
const match = api.matches && api.matches[0];
check('存在房间', match !== undefined, api.matches && api.matches.length);
if (!match) {
    console.log('❌ 没有房间可验证（无需处理，正常状态）');
    process.exit(failures ? 1 : 0);
}
console.log(`  房间: ${match.matchID} (createdAt=${new Date(match.createdAt).toLocaleString()})`);

// 2. GM 旁观者连接同步
console.log('== 2. GM（旁观者 -1）连接同步 ==');
const cgm = Client({
    game: SanGuoSha,
    multiplayer: SocketIO({ server: SERVER }),
    matchID: match.matchID,
    playerID: '-1',
});
cgm.start();
let stg = null;
for (let i = 0; i < 50; i++) {
    await sleep(200);
    const st = cgm.getState();
    if (st && st.G) { stg = st; break; }
}
check('GM WebSocket 同步成功', stg !== null && stg.G !== undefined);
if (!stg) {
    console.log('❌ 同步失败（服务器可能跑的是旧代码或 WebSocket 不通）');
    process.exit(1);
}

check('状态结构含 playerImages（新代码）', stg.G.playerImages !== undefined, Object.keys(stg.G.playerImages || {}));
check('状态结构含 healths（新代码）', stg.G.healths !== undefined && stg.G.healths['0'] !== undefined, stg.G.healths && stg.G.healths['0']);
check('状态结构含 hands', stg.G.hands !== undefined, Object.keys(stg.G.hands || {}));
check('GM 处于 gm 阶段（gmReset 可用）', stg.ctx.activePlayers && stg.ctx.activePlayers['-1'] === 'gm', stg.ctx.activePlayers);
const handSizes = Object.keys(stg.G.hands).map(k => `${k}:${stg.G.hands[k].length}`);
console.log(`  各座位手牌数: ${handSizes.join(' ')}`);
check('GM 能看到玩家0手牌', stg.G.hands['0'] !== undefined);

// 3. 前端构建包含新功能
console.log('== 3. 前端构建版本 ==');
const html = await (await fetch(`${SERVER}/`)).text();
const mainChunk = (html.match(/main\.[a-f0-9]+\.chunk\.js/) || [])[0];
check('首页正常加载', html.includes('跑团卡牌桌'));
// 构建器（Terser）可能把中文转成 \uXXXX 转义，两种形式都检查
const esc = s => Array.from(s).map(c => '\\u' + c.charCodeAt(0).toString(16).padStart(4, '0')).join('');
const hasStr = (js, s) => js.includes(s) || js.includes(esc(s));
if (mainChunk) {
    const js = await (await fetch(`${SERVER}/static/js/${mainChunk}`)).text();
    check('前端含“清空房间”按钮（新构建）', hasStr(js, '清空房间'), mainChunk);
    check('前端含 gmReset 逻辑（新构建）', js.includes('gmReset'), mainChunk);
    check('前端含体力上限输入（新构建）', hasStr(js, '体力上限') || js.includes('setMaxHealth'), mainChunk);
} else {
    check('找到 main chunk', false);
}

cgm.stop();
console.log('');
if (failures === 0) {
    console.log('✅ 远程验证全部通过：部署正常，新功能已上线');
    process.exit(0);
} else {
    console.log(`❌ 有 ${failures} 项失败`);
    process.exit(1);
}
