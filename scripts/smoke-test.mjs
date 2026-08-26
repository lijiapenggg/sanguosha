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
check('未发身份牌（rolesDealt=false）', st0.G.rolesDealt === false);
check('全员未就位', st0.G.ready && ['0', '1', '2', '3', '4'].every(p => st0.G.ready[p] === false), st0.G.ready);

console.log('== 4. 就位 → GM 发身份牌 → 展示主公并交接回合 ==');
const clients = [c0];
for (let i = 1; i < 5; i++) {
    const c = Client({
        game: SanGuoSha,
        multiplayer: SocketIO({ server: SERVER }),
        matchID,
        playerID: i.toString(),
        credentials: creds[i.toString()],
    });
    c.start();
    clients.push(c);
    await waitForState(c, st => st.G && st.G.hands && st.G.hands[i.toString()]);
}
// 普通玩家尝试发身份牌（应在服务端被拒绝）
const stBefore = c0.getState();
c0.moves.dealRoles();
await sleep(600);
check('普通玩家不能发身份牌', c0.getState().G.rolesDealt === false, c0.getState().G.rolesDealt);
// 全员就位（串行等待，避免并发时序问题）
for (let i = 0; i < 5; i++) {
    clients[i].moves.ready();
    await waitForState(c0, st => st.G.ready[String(i)] === true);
}
check('全员就位', ['0', '1', '2', '3', '4'].every(p => c0.getState().G.ready[p] === true), c0.getState().G.ready);
// GM 连接
const cgm = Client({
    game: SanGuoSha,
    multiplayer: SocketIO({ server: SERVER }),
    matchID,
    playerID: '-1',
});
cgm.start();
await waitForState(cgm, st => st.G && st.G.ready && st.G.ready['0'] === true);
// GM 发身份牌
cgm.moves.dealRoles();
await waitForState(c0, st => st.G.rolesDealt === true);
const stRoles = cgm.getState();
const gmRoles = stRoles.G.roles;
const king = Object.keys(gmRoles).find(p => gmRoles[p] === 'King');
const kingMaxBefore = stRoles.G.healths[king].max;
check('身份分布正确（1主公 2反贼 1忠臣 1内奸）',
    Object.values(gmRoles).filter(r => r === 'King').length === 1
    && Object.values(gmRoles).filter(r => r === 'Rebel').length === 2
    && Object.values(gmRoles).filter(r => r === 'Loyalist').length === 1
    && Object.values(gmRoles).filter(r => r === 'Spy').length === 1,
    gmRoles);
check('GM 能看到所有玩家身份', ['0', '1', '2', '3', '4'].every(p => gmRoles[p] !== undefined && gmRoles[p] !== 'hidden'), gmRoles);
// 玩家视角：只见自己身份
const stp0 = c0.getState();
check('玩家0只见自己的身份，他人隐藏',
    stp0.G.roles['0'] === gmRoles['0']
    && ['1', '2', '3', '4'].every(p => stp0.G.roles[p] === 'hidden'),
    stp0.G.roles);
// 当前回合玩家（0）把回合交给主公并展示主公
c0.moves.revealKingAndHandTurn();
await waitForState(c0, st => st.G.kingRevealed === true && st.ctx.currentPlayer === king);
const stp0b = c0.getState();
check('主公身份已对所有人展示', stp0b.G.roles[king] === 'King', stp0b.G.roles);
check('回合已切换到主公', stp0b.ctx.currentPlayer === king, stp0b.ctx.currentPlayer);
check('主公血量自动 +30（龙城卡血量 + 主公加成）',
    stp0b.G.healths[king].max === kingMaxBefore + 30
    && stp0b.G.healths[king].current === kingMaxBefore + 30
    && stp0b.G.kingBonusApplied === true,
    stp0b.G.healths[king]);

console.log('== 5. 玩家 0 摸一张牌 ==');
c0.moves.draw();
const st0d = await waitForState(c0, st => st.G.hands['0'].length === 5);
check('手牌变为 5 张', st0d.G.hands['0'].length === 5);

console.log('== 6. 玩家 0 上传图片 ==');
c0.moves.setImage('data:image/jpeg;base64,Zm9vYmFy');
const st0e = await waitForState(c0, st => st.G.playerImages['0'] !== undefined);
check('playerImages[0] 已设置', st0e.G.playerImages['0'] === 'data:image/jpeg;base64,Zm9vYmFy');

console.log('== 7. 玩家 0 设定体力上限（D&D HP） ==');
c0.moves.setMaxHealth(50);
const st0f = await waitForState(c0, st => st.G.healths['0'].max === 50);
check('体力上限设为 50 且回满', st0f.G.healths['0'].max === 50 && st0f.G.healths['0'].current === 50, st0f.G.healths['0']);
c0.moves.setMaxHealth(0);
await waitForState(c0, st => st.G.healths['0'].max === 1);
check('非法输入（0）被钳制为 1', c0.getState().G.healths['0'].max === 1, c0.getState().G.healths['0']);
c0.moves.setMaxHealth(50);
await waitForState(c0, st => st.G.healths['0'].max === 50);
check('恢复上限为 50', c0.getState().G.healths['0'].max === 50, c0.getState().G.healths['0']);

console.log('== 8. GM（旁观者 -1）应能看到所有玩家手牌与身份 ==');
const stg = await waitForState(cgm, st => st.G.hands && st.G.hands['0'] && st.G.hands['0'].length === 5);
check('GM 能看到玩家0手牌（5张）', stg.G.hands['0'].length === 5, stg.G.hands['0'].length);
check('GM 能看到手牌内容（牌面朝上数据）', typeof stg.G.hands['0'][0].type === 'string' && typeof stg.G.hands['0'][0].value === 'string', stg.G.hands['0'][0]);
check('GM 能看到玩家0上传的图片', stg.G.playerImages['0'] === 'data:image/jpeg;base64,Zm9vYmFy');
check('GM 能看到所有玩家体力', stg.G.healths['0'] && stg.G.healths['1'] && stg.G.healths['4']);
check('GM 能看到玩家名对应的手牌数（4位其他玩家各4张）',
    [1, 2, 3, 4].every(i => stg.G.hands[i.toString()].length === 4),
    [1, 2, 3, 4].map(i => stg.G.hands[i.toString()].length));
check('GM 能看到所有身份（含主公）', stg.G.roles[king] === 'King', stg.G.roles);

console.log('== 9. GM 不能执行普通操作 ==');
const deckBefore = stg.G.deck.length;
try {
    cgm.moves.draw();
} catch (e) {
    // 某些情况下客户端会直接拒绝，属正常
}
await sleep(600);
const stg2 = cgm.getState();
check('GM 摸牌后牌堆数量不变', stg2.G.deck.length === deckBefore, { before: deckBefore, after: stg2.G.deck.length });

console.log('== 10. 卡牌指向：玩家 0 摸到【杀】并指向玩家 1 ==');
let attackIdx = c0.getState().G.hands['0'].findIndex(c => c.type === 'Attack');
let guard = 0;
while (attackIdx === -1 && guard < 40) {
    const before = c0.getState().G.hands['0'].length;
    c0.moves.draw();
    await waitForState(c0, st => st.G.hands['0'].length === before + 1);
    attackIdx = c0.getState().G.hands['0'].findIndex(c => c.type === 'Attack');
    guard++;
}
check('玩家0手牌中找到了【杀】', attackIdx !== -1, guard);
if (attackIdx !== -1) {
    c0.moves.playTargeted(attackIdx, '1');
    await waitForState(c0, st => st.G.targets && st.G.targets.length >= 1);
    const tg = c0.getState().G.targets[c0.getState().G.targets.length - 1];
    check('指向记录：玩家0 用【杀】指向 玩家1', tg.source === '0' && tg.target === '1' && tg.cardType === 'Attack', tg);
    // 等 GM 与目标玩家的客户端都收到这次指向广播
    await waitForState(cgm, st => st.G.targets && st.G.targets.some(t => t.source === '0' && t.target === '1' && t.cardType === 'Attack'));
    await waitForState(clients[1], st => st.G.targets && st.G.targets.some(t => t.source === '0' && t.target === '1' && t.cardType === 'Attack'));
    check('GM 也能看到这次指向', cgm.getState().G.targets.some(t => t.source === '0' && t.target === '1' && t.cardType === 'Attack'), cgm.getState().G.targets);
    check('目标玩家（玩家1）也能看到指向', clients[1].getState().G.targets.some(t => t.source === '0' && t.target === '1' && t.cardType === 'Attack'), clients[1].getState().G.targets);
}

console.log('== 11. 顺手牵羊 / 过河拆桥 ==');
const st1 = clients[1].getState();
const p0handBefore = st1.G.hands['0'].length;
clients[1].moves.steal({ playerID: '0', index: 0 });
const st1b = await waitForState(clients[1], st => st.G.hands['1'].length === st1.G.hands['1'].length + 1);
check('玩家1手牌 +1', st1b.G.hands['1'].length === st1.G.hands['1'].length + 1);
check('玩家0手牌 -1', st1b.G.hands['0'].length === p0handBefore - 1, { before: p0handBefore, after: st1b.G.hands['0'].length });
const p0hand2 = clients[2].getState().G.hands['0'].length;
clients[2].moves.dismantle({ playerID: '0', index: 0 });
const st2b = await waitForState(clients[2], st => st.G.hands['0'].length === p0hand2 - 1);
check('玩家0手牌 -1（被拆）', st2b.G.hands['0'].length === p0hand2 - 1);

console.log('== 12. 普通玩家不能调用 GM 清空 ==');
await waitForState(clients[1], st => st.G.hands['0'].length === p0hand2 - 1);
const handBefore12 = clients[1].getState().G.hands['0'].length;
clients[1].moves.gmReset();
await sleep(600);
check('玩家调用 gmReset 无效（手牌不变）', clients[1].getState().G.hands['0'].length === handBefore12, { before: handBefore12, after: clients[1].getState().G.hands['0'].length });

console.log('== 13. GM 一键清空房间（重新开局） ==');
cgm.moves.gmReset();
const stReset = await waitForState(cgm, st => st.G.rolesDealt === false && st.G.hands['0'].length === 4);
check('清空后回到未发牌状态', stReset.G.rolesDealt === false && stReset.G.kingRevealed === false, { rolesDealt: stReset.G.rolesDealt });
check('清空后就位状态重置', ['0', '1', '2', '3', '4'].every(p => stReset.G.ready[p] === false), stReset.G.ready);
check('清空后指向清空', stReset.G.targets.length === 0, stReset.G.targets);
check('清空后每人重新发 4 张', stReset.G.hands['0'].length === 4 && stReset.G.hands['4'].length === 4, [0, 4].map(i => stReset.G.hands[i.toString()].length));
check('清空后弃牌堆为空', stReset.G.discard.length === 0, stReset.G.discard.length);
check('清空后牌堆 = 160 - 20', stReset.G.deck.length === 140, stReset.G.deck.length);
check('清空后体力回满且保留上限（玩家0=50，主公含+30加成，其余=3）',
    stReset.G.healths['0'].current === 50 && stReset.G.healths['0'].max === 50
    && stReset.G.healths[king].max === (king === '0' ? 50 : kingMaxBefore + 30)
    && ['1', '2', '3', '4'].filter(p => p !== king).every(p => stReset.G.healths[p].current === 3 && stReset.G.healths[p].max === 3),
    stReset.G.healths);
check('清空后主公加成标记重置', stReset.G.kingBonusApplied === false, stReset.G.kingBonusApplied);
check('清空后保留玩家图片', stReset.G.playerImages['0'] === 'data:image/jpeg;base64,Zm9vYmFy');

console.log('== 14. 手牌上限随生命分段动态变化（健康4/受伤2/重伤1，主公+1） ==');
// gmReset 后身份已重置，先重新走：就位 → 发身份牌 → 展示主公（主公 +1 手牌上限才生效）
for (let i = 0; i < 5; i++) {
    clients[i].moves.ready();
    await waitForState(cgm, st => st.G.ready[String(i)] === true);
}
cgm.moves.dealRoles();
await waitForState(cgm, st => st.G.rolesDealt === true);
const king2 = Object.keys(cgm.getState().G.roles).find(p => cgm.getState().G.roles[p] === 'King');
const curP = cgm.getState().ctx.currentPlayer;
clients[parseInt(curP, 10)].moves.revealKingAndHandTurn();
await waitForState(cgm, st => st.G.kingRevealed === true && st.ctx.currentPlayer === king2);
const kingClient = clients[parseInt(king2, 10)];
// 主公自定上限 40，满血，手牌 4 张（gmReset 后重新发牌前）
kingClient.moves.setMaxHealth(40);
await waitForState(kingClient, st => st.G.healths[king2].max === 40 && st.G.healths[king2].current === 40);
check('主公设定上限 40 且满血', kingClient.getState().G.healths[king2].current === 40, kingClient.getState().G.healths[king2]);
// 场景A：受伤段（25%<HP≤50%）。40→16 → 16/40=40% → 基础2+主公1=3
kingClient.moves.updateHealth(-24);
await waitForState(kingClient, st => st.G.healths[king2].current === 16);
check('主公受伤段（16/40）', kingClient.getState().G.healths[king2].current === 16, kingClient.getState().G.healths[king2]);
kingClient.moves.endPlay();
await waitForState(kingClient, st => st.ctx.activePlayers && st.ctx.activePlayers[king2] === 'discard');
check('受伤段：手牌4 > 上限3 → 进入弃牌阶段', kingClient.getState().ctx.activePlayers[king2] === 'discard');
kingClient.moves.discardCard(0);
await waitForState(kingClient, st => st.G.hands[king2].length === 3);
const stK1 = kingClient.getState();
check('弃1张到3 ≤ 上限3 → 回合结束（证明受伤段上限=3=2+主公1）',
    stK1.ctx.currentPlayer !== king2 && stK1.G.hands[king2].length === 3,
    { hand: stK1.G.hands[king2].length, currentPlayer: stK1.ctx.currentPlayer });
// 场景B：重伤段（HP≤25%）。先把回合轮转回主公：其余玩家满血手牌4 ≤ 上限4 → 立即结束回合
for (let i = 0; i < 4; i++) {
    const cur = kingClient.getState().ctx.currentPlayer;
    const curClient = clients[parseInt(cur, 10)];
    curClient.moves.endPlay();
    await waitForState(curClient, st => st.ctx.currentPlayer !== cur);
}
check('回合已轮转回主公', kingClient.getState().ctx.currentPlayer === king2, kingClient.getState().ctx.currentPlayer);
// 主公 16→10 → 10/40=25% ≤25% → 基础1+主公1=2；此时手牌 3
kingClient.moves.updateHealth(-6);
await waitForState(kingClient, st => st.G.healths[king2].current === 10);
kingClient.moves.endPlay();
await waitForState(kingClient, st => st.ctx.activePlayers && st.ctx.activePlayers[king2] === 'discard');
check('重伤段：手牌3 > 上限2 → 进入弃牌阶段', kingClient.getState().ctx.activePlayers[king2] === 'discard');
kingClient.moves.discardCard(0);
await waitForState(kingClient, st => st.G.hands[king2].length === 2);
const stK2 = kingClient.getState();
check('弃1张到2 ≤ 上限2 → 回合结束（证明重伤段上限=2=1+主公1）',
    stK2.ctx.currentPlayer !== king2 && stK2.G.hands[king2].length === 2,
    { hand: stK2.G.hands[king2].length, currentPlayer: stK2.ctx.currentPlayer });

for (const c of clients) {
    c.stop();
}
cgm.stop();

console.log('');
if (failures === 0) {
    console.log('✅ 冒烟测试全部通过');
    process.exit(0);
} else {
    console.log(`❌ 有 ${failures} 项失败`);
    process.exit(1);
}
