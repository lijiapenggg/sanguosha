/**
 * 无头冒烟测试：验证改造后的服务端逻辑
 * 运行前提：服务器已在 8098 端口启动（npm run server）
 * 运行方式：node scripts/smoke-test.mjs
 */
import { LobbyClient, Client } from 'boardgame.io/dist/cjs/client.js';
import { SocketIO } from 'boardgame.io/dist/cjs/multiplayer.js';
import { SanGuoSha } from '../src/lib/game.js';

const SERVER = 'http://localhost:8098';
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

async function waitForState(client, pred, timeoutMs = 8000) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
        const st = client.getState();
        if (st && st.ctx && pred(st)) {
            return st;
        }
        await sleep(100);
    }
    throw new Error('timeout waiting for state');
}

const lobby = new LobbyClient({ server: SERVER });

console.log('== 1. 创建房间（5 人，singleton 标记） ==');
const { matchID } = await lobby.createMatch(SanGuoSha.name, {
    numPlayers: 5,
    setupData: { singleton: true },
});
check('创建成功，拿到 matchID', typeof matchID === 'string' && matchID.length > 0, matchID);

const { matches } = await lobby.listMatches(SanGuoSha.name);
const m = matches.find(x => x.matchID === matchID);
check('房间存在且有 5 个座位', m !== undefined && m.players.length === 5, m && m.players.length);
check('setupData.singleton = true', m !== undefined && m.setupData && m.setupData.singleton === true, m && m.setupData);

console.log('== 2. 5 名玩家依次加入 ==');
const creds = {};
for (let i = 0; i < 5; i++) {
    const { playerCredentials } = await lobby.joinMatch(SanGuoSha.name, matchID, {
        playerID: i.toString(),
        playerName: `玩家${'一二三四五'[i]}`,
    });
    creds[i] = playerCredentials;
    check(`玩家 ${i} 加入成功`, typeof playerCredentials === 'string' && playerCredentials.length > 0);
}

console.log('== 3. 玩家 0 连接并检查初始状态 ==');
const c0 = Client({
    game: SanGuoSha,
    multiplayer: SocketIO({ server: SERVER }),
    matchID,
    playerID: '0',
    credentials: creds['0'],
});
c0.start();
const st0 = await waitForState(c0, st => st.G && st.G.hands && st.G.hands['0']);
check('开局每人 4 张手牌（玩家0）', st0.G.hands['0'].length === 4, st0.G.hands['0'].length);
check('初始体力 3/3', st0.G.healths['0'].max === 3 && st0.G.healths['0'].current === 3, st0.G.healths['0']);
check('playerImages 已初始化', st0.G.playerImages !== undefined && st0.G.playerImages['0'] === undefined);

console.log('== 4. 玩家 0 摸一张牌 ==');
c0.moves.draw();
const st0b = await waitForState(c0, st => st.G.hands['0'].length === 5);
check('手牌变为 5 张', st0b.G.hands['0'].length === 5);

console.log('== 5. 玩家 0 上传图片 ==');
c0.moves.setImage('data:image/jpeg;base64,Zm9vYmFy');
const st0c = await waitForState(c0, st => st.G.playerImages['0'] !== undefined);
check('playerImages[0] 已设置', st0c.G.playerImages['0'] === 'data:image/jpeg;base64,Zm9vYmFy');

console.log('== 6. 玩家 0 调整体力 ==');
c0.moves.updateHealth(-1);
const st0d = await waitForState(c0, st => st.G.healths['0'].current === 2);
check('体力变为 2/3', st0d.G.healths['0'].current === 2);

console.log('== 6b. 玩家 0 自行输入体力上限（D&D HP） ==');
c0.moves.setMaxHealth(50);
const st0e = await waitForState(c0, st => st.G.healths['0'].max === 50);
check('体力上限设为 50 且回满', st0e.G.healths['0'].max === 50 && st0e.G.healths['0'].current === 50, st0e.G.healths['0']);
c0.moves.setMaxHealth(0);
const st0f = await waitForState(c0, st => st.G.healths['0'].max === 1);
check('非法输入（0）被钳制为 1', st0f.G.healths['0'].max === 1 && st0f.G.healths['0'].current === 1, st0f.G.healths['0']);
c0.moves.setMaxHealth(50);
await waitForState(c0, st => st.G.healths['0'].max === 50);
check('恢复上限为 50', c0.getState().G.healths['0'].max === 50, c0.getState().G.healths['0']);

console.log('== 7. GM（旁观者 -1）连接，应看到所有玩家手牌 ==');
const cgm = Client({
    game: SanGuoSha,
    multiplayer: SocketIO({ server: SERVER }),
    matchID,
    playerID: '-1',
});
cgm.start();
const stg = await waitForState(cgm, st => st.G && st.G.hands && st.G.hands['0']);
check('GM 能看到玩家0手牌（5张）', stg.G.hands['0'].length === 5, stg.G.hands['0'].length);
check('GM 能看到手牌内容（牌面朝上数据）', typeof stg.G.hands['0'][0].type === 'string' && typeof stg.G.hands['0'][0].value === 'string', stg.G.hands['0'][0]);
check('GM 能看到玩家0上传的图片', stg.G.playerImages['0'] === 'data:image/jpeg;base64,Zm9vYmFy');
check('GM 能看到所有玩家体力', stg.G.healths['0'] && stg.G.healths['1'] && stg.G.healths['4']);
check('GM 能看到玩家名对应的手牌数（4位其他玩家各4张）',
    [1, 2, 3, 4].every(i => stg.G.hands[i.toString()].length === 4),
    [1, 2, 3, 4].map(i => stg.G.hands[i.toString()].length));

console.log('== 8. GM 不能执行操作（旁观者无权移动） ==');
const deckBefore = stg.G.deck.length;
try {
    cgm.moves.draw();
} catch (e) {
    // 某些情况下客户端会直接拒绝，属正常
}
await sleep(600);
const stg2 = cgm.getState();
check('GM 摸牌后牌堆数量不变', stg2.G.deck.length === deckBefore, { before: deckBefore, after: stg2.G.deck.length });

console.log('== 9. 玩家 1 用顺手牵羊偷玩家 0 的牌 ==');
const c1 = Client({
    game: SanGuoSha,
    multiplayer: SocketIO({ server: SERVER }),
    matchID,
    playerID: '1',
    credentials: creds['1'],
});
c1.start();
const st1 = await waitForState(c1, st => st.G && st.G.hands && st.G.hands['1']);
const p0handBefore = st1.G.hands['0'].length;
c1.moves.steal({ playerID: '0', index: 0 });
const st1b = await waitForState(c1, st => st.G.hands['1'].length === st1.G.hands['1'].length + 1);
check('玩家1手牌 +1', st1b.G.hands['1'].length === st1.G.hands['1'].length + 1);
check('玩家0手牌 -1', st1b.G.hands['0'].length === p0handBefore - 1, { before: p0handBefore, after: st1b.G.hands['0'].length });

console.log('== 10. 过河拆桥：玩家 2 弃掉玩家 0 的一张手牌 ==');
const c2 = Client({
    game: SanGuoSha,
    multiplayer: SocketIO({ server: SERVER }),
    matchID,
    playerID: '2',
    credentials: creds['2'],
});
c2.start();
const st2 = await waitForState(c2, st => st.G && st.G.hands && st.G.hands['2']);
const p0hand2 = st2.G.hands['0'].length;
c2.moves.dismantle({ playerID: '0', index: 0 });
const st2b = await waitForState(c2, st => st.G.hands['0'].length === p0hand2 - 1);
check('玩家0手牌 -1（被拆）', st2b.G.hands['0'].length === p0hand2 - 1);

console.log('== 11. 普通玩家不能调用 GM 清空 ==');
// 先等玩家1客户端同步完第10步（过河拆桥后玩家0手牌应为 3），再测试
await waitForState(c1, st => st.G.hands['0'].length === 3);
const handBefore11 = c1.getState().G.hands['0'].length;
c1.moves.gmReset();
await sleep(600);
const stNoReset = c1.getState();
check('玩家调用 gmReset 无效（手牌不变）', stNoReset.G.hands['0'].length === handBefore11, { before: handBefore11, after: stNoReset.G.hands['0'].length });

console.log('== 12. GM 一键清空房间（重新开局） ==');
cgm.moves.gmReset();
const stReset = await waitForState(cgm, st => st.G.hands['0'].length === 4);
check('清空后每人重新发 4 张', stReset.G.hands['0'].length === 4 && stReset.G.hands['4'].length === 4, [0, 4].map(i => stReset.G.hands[i.toString()].length));
check('清空后弃牌堆为空', stReset.G.discard.length === 0, stReset.G.discard.length);
check('清空后牌堆 = 160 - 20', stReset.G.deck.length === 140, stReset.G.deck.length);
check('清空后体力回满且保留上限（玩家0=50，其余=3）',
    stReset.G.healths['0'].current === 50 && stReset.G.healths['0'].max === 50
    && stReset.G.healths['1'].current === 3 && stReset.G.healths['1'].max === 3,
    stReset.G.healths);
check('清空后保留玩家图片', stReset.G.playerImages['0'] === 'data:image/jpeg;base64,Zm9vYmFy');

c0.stop();
cgm.stop();
c1.stop();
c2.stop();

console.log('');
if (failures === 0) {
    console.log('✅ 冒烟测试全部通过');
    process.exit(0);
} else {
    console.log(`❌ 有 ${failures} 项失败`);
    process.exit(1);
}
