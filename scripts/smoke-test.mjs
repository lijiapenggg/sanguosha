/**
 * 无头冒烟测试：验证改造后的服务端逻辑
 * 运行前提：服务器已在 8098 端口启动（npm run server）
 * 运行方式：node scripts/smoke-test.mjs
 */
import { LobbyClient, Client } from 'boardgame.io/dist/cjs/client.js';
import { SocketIO } from 'boardgame.io/dist/cjs/multiplayer.js';
import { SanGuoSha, TARGETED_CARDS, WEAPON_TYPES, ARMOR_TYPES, OFFENSIVE_HORSE_TYPES, DEFENSIVE_HORSE_TYPES, equipSlotOf, JUDGMENT_CARDS, handLimitOf } from '../src/lib/game.js';

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

// 当前玩家走完"结束出牌 → 弃牌阶段 → 结束回合"：弃至上限以内后结束（或直接结束）
async function endTurn(client, playerID) {
    client.moves.endPlay();
    await waitForState(client, st => st.ctx.activePlayers && st.ctx.activePlayers[playerID] === 'discard');
    // 手牌超过上限则先弃牌（直接点牌即弃，不需要指向）
    let st = client.getState();
    let guard = 0;
    while (st.G.hands[playerID].length > handLimitOf(st.G, playerID) && guard < 30) {
        client.moves.discardCard(0);
        await waitForState(client, s => s.G.hands[playerID].length < st.G.hands[playerID].length);
        st = client.getState();
        guard++;
    }
    if (client.getState().ctx.currentPlayer === playerID) {
        client.moves.finishDiscard();
    }
    await waitForState(client, s => s.ctx.currentPlayer !== playerID);
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

console.log('== 10b. 指向连线：下一张牌后消失/被替换 ==');
// 再打一张指向牌 → 只保留最新一条（旧连线被替换）
// 找不到就继续摸牌，确保替换逻辑被测到
let tIdx2 = c0.getState().G.hands['0'].findIndex(c => TARGETED_CARDS.includes(c.type));
guard = 0;
while (tIdx2 === -1 && guard < 40) {
    const before = c0.getState().G.hands['0'].length;
    c0.moves.draw();
    await waitForState(c0, st => st.G.hands['0'].length === before + 1);
    tIdx2 = c0.getState().G.hands['0'].findIndex(c => TARGETED_CARDS.includes(c.type));
    guard++;
}
if (tIdx2 !== -1) {
    c0.moves.playTargeted(tIdx2, '2');
    await waitForState(c0, st => st.G.targets && st.G.targets.length === 1 && st.G.targets[0].target === '2');
    check('新指向替换旧连线（只剩 1 条）', c0.getState().G.targets.length === 1 && c0.getState().G.targets[0].target === '2', c0.getState().G.targets);
    // 确保其他客户端也追上最新状态（避免后续卡牌操作因过期 stateID 被拒）
    await waitForState(clients[1], st => st.G.targets && st.G.targets.length === 1 && st.G.targets[0].target === '2');
    await waitForState(clients[2], st => st.G.targets && st.G.targets.length === 1 && st.G.targets[0].target === '2');
} else {
    console.log('  跳过：手牌无第二张指向牌');
}
// 打一张普通牌 → 连线消失
const tIdx3 = c0.getState().G.hands['0'].findIndex(c => !TARGETED_CARDS.includes(c.type));
if (tIdx3 !== -1) {
    c0.moves.play(tIdx3);
    await waitForState(c0, st => st.G.targets && st.G.targets.length === 0);
    check('打出普通牌后连线消失', c0.getState().G.targets.length === 0, c0.getState().G.targets);
    // 同样确保其他客户端追上，再进入第 11 节（steal/dismantle 会因过期 stateID 被拒）
    await waitForState(clients[1], st => st.G.targets && st.G.targets.length === 0);
    await waitForState(clients[2], st => st.G.targets && st.G.targets.length === 0);
} else {
    console.log('  跳过：手牌无普通牌');
}

console.log('== 11. 顺手牵羊 / 过河拆桥 ==');
// 全部以 GM 客户端（cgm，从未发过 move，状态永远最新）为权威读数
const p0handBefore = cgm.getState().G.hands['0'].length;
const p1handBefore = cgm.getState().G.hands['1'].length;
clients[1].moves.steal({ playerID: '0', index: 0 });
await waitForState(cgm, st => st.G.hands['1'].length === p1handBefore + 1);
check('玩家1手牌 +1', cgm.getState().G.hands['1'].length === p1handBefore + 1);
check('玩家0手牌 -1', cgm.getState().G.hands['0'].length === p0handBefore - 1, { before: p0handBefore, after: cgm.getState().G.hands['0'].length });
const p0hand2 = cgm.getState().G.hands['0'].length;
clients[2].moves.dismantle({ playerID: '0', index: 0 });
await waitForState(cgm, st => st.G.hands['0'].length === p0hand2 - 1);
check('玩家0手牌 -1（被拆）', cgm.getState().G.hands['0'].length === p0hand2 - 1);

console.log('== 12. 普通玩家不能调用 GM 清空 ==');
const handBefore12 = cgm.getState().G.hands['0'].length;
clients[1].moves.gmReset();
await sleep(600);
check('玩家调用 gmReset 无效（手牌不变）', cgm.getState().G.hands['0'].length === handBefore12, { before: handBefore12, after: cgm.getState().G.hands['0'].length });

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
// 场景B：重伤段（HP≤25%）。先把回合轮转回主公：其余玩家满血手牌4 ≤ 上限4 → 结束回合
for (let i = 0; i < 4; i++) {
    const cur = kingClient.getState().ctx.currentPlayer;
    const curClient = clients[parseInt(cur, 10)];
    await endTurn(curClient, cur);
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

console.log('== 14b. 回合按顺序流转（结束回合 → 下一位） ==');
// 从当前 currentPlayer 开始，连续"结束回合"5 次，应回到起始玩家（一圈）
const startP = cgm.getState().ctx.currentPlayer;
const order = [startP];
for (let i = 0; i < 5; i++) {
    const cur = cgm.getState().ctx.currentPlayer;
    const curClient = clients[parseInt(cur, 10)];
    await endTurn(curClient, cur);
    order.push(cgm.getState().ctx.currentPlayer);
}
check('回合按顺序流转一圈（5 步回到起点，且无重复相邻）',
    order[5] === startP && order.every((p, i) => i === 0 || order[i - 1] !== p),
    order);

console.log('== 14c. HP 当前值与上限分别输入（setHealth） ==');
// 用玩家 0（非主公）测试：只改当前值 / 只改上限 / 同时改
{
    const c0s = clients[0];
    c0s.moves.setHealth({ current: 7, max: 20 });
    await waitForState(cgm, st => st.G.healths['0'].current === 7 && st.G.healths['0'].max === 20);
    check('同时设置当前值 7 与上限 20', cgm.getState().G.healths['0'].current === 7 && cgm.getState().G.healths['0'].max === 20, cgm.getState().G.healths['0']);
    c0s.moves.setHealth({ max: 30 });
    await waitForState(cgm, st => st.G.healths['0'].max === 30 && st.G.healths['0'].current === 7);
    check('只改上限 30，当前值保持不变', cgm.getState().G.healths['0'].max === 30 && cgm.getState().G.healths['0'].current === 7, cgm.getState().G.healths['0']);
    c0s.moves.setHealth({ current: 99 });
    await waitForState(cgm, st => st.G.healths['0'].current === 30);
    check('当前值超过上限被钳制为上限 30', cgm.getState().G.healths['0'].current === 30, cgm.getState().G.healths['0']);
    // 恢复默认（避免影响后续节）
    c0s.moves.setHealth({ current: 50, max: 50 });
    await waitForState(cgm, st => st.G.healths['0'].current === 50 && st.G.healths['0'].max === 50);
    check('恢复 HP 50/50', cgm.getState().G.healths['0'].current === 50 && cgm.getState().G.healths['0'].max === 50, cgm.getState().G.healths['0']);
}

console.log('== 17. 装备栏：装备牌进装备栏而非弃牌堆，可卸下，全桌明牌 ==');
// 用玩家 0 摸牌找一张装备牌
{
    const c0s = clients[0];
    const isEquip = c => equipSlotOf(c.type) !== undefined;
    let equipIdx = c0s.getState().G.hands['0'].findIndex(isEquip);
    let guard = 0;
    while (equipIdx === -1 && guard < 60) {
        const before = c0s.getState().G.hands['0'].length;
        c0s.moves.draw();
        await waitForState(c0s, st => st.G.hands['0'].length === before + 1);
        equipIdx = c0s.getState().G.hands['0'].findIndex(isEquip);
        guard++;
    }
    check('玩家0手牌中找到了装备牌', equipIdx !== -1, guard);
    if (equipIdx !== -1) {
        // 索引与读卡都基于玩家0本地状态（自洽）；断言前再等 GM 同步到一致状态
        const card = c0s.getState().G.hands['0'][equipIdx];
        const slot = equipSlotOf(card.type);
        const handBefore = c0s.getState().G.hands['0'].length;
        await waitForState(cgm, st => st.G.hands['0'].length === handBefore);
        const discardBefore = cgm.getState().G.discard.length;
        // 打出装备牌 → 应进装备栏而非弃牌堆
        c0s.moves.play(equipIdx);
        await waitForState(cgm, st => st.G.equipment && st.G.equipment['0'][slot] !== undefined);
        const stAfter = cgm.getState();
        check('装备牌进装备栏（槽位 ' + slot + '）', stAfter.G.equipment['0'][slot] !== undefined && stAfter.G.equipment['0'][slot].id === card.id, stAfter.G.equipment['0'][slot]);
        check('手牌 -1', stAfter.G.hands['0'].length === handBefore - 1, { before: handBefore, after: stAfter.G.hands['0'].length });
        check('装备牌未进弃牌堆', stAfter.G.discard.length === discardBefore, { before: discardBefore, after: stAfter.G.discard.length });
        // GM 也能看到装备（明牌）
        check('GM 能看到该装备（明牌）', cgm.getState().G.equipment['0'][slot] !== undefined, cgm.getState().G.equipment['0'][slot]);
        // 卸下（拖出扔到桌上）→ 装备进弃牌堆、槽位清空
        c0s.moves.unequip(slot);
        await waitForState(cgm, st => st.G.equipment['0'][slot] === undefined);
        const stUneq = cgm.getState();
        check('卸下后槽位清空', stUneq.G.equipment['0'][slot] === undefined, stUneq.G.equipment['0'][slot]);
        check('卸下的装备进弃牌堆', stUneq.G.discard.some(c => c.id === card.id), stUneq.G.discard.map(c => c.id).includes(card.id));
        // 拖拽装备（equipByCardId）：再找一张装备牌，按 cardId 装备
        equipIdx = c0s.getState().G.hands['0'].findIndex(isEquip);
        guard = 0;
        while (equipIdx === -1 && guard < 60) {
            const before = c0s.getState().G.hands['0'].length;
            c0s.moves.draw();
            await waitForState(c0s, st => st.G.hands['0'].length === before + 1);
            equipIdx = c0s.getState().G.hands['0'].findIndex(isEquip);
            guard++;
        }
        if (equipIdx !== -1) {
            const card2 = c0s.getState().G.hands['0'][equipIdx];
            const slot2 = equipSlotOf(card2.type);
            c0s.moves.equipByCardId(card2.id);
            await waitForState(cgm, st => st.G.equipment['0'][slot2] !== undefined && st.G.equipment['0'][slot2].id === card2.id);
            check('拖拽装备（equipByCardId）成功', cgm.getState().G.equipment['0'][slot2].id === card2.id, cgm.getState().G.equipment['0'][slot2]);
            // 同槽位再装备 → 旧装备进弃牌堆、新装备替换
            const oldCardId = card2.id;
            equipIdx = c0s.getState().G.hands['0'].findIndex(c => equipSlotOf(c.type) === slot2);
            guard = 0;
            while (equipIdx === -1 && guard < 60) {
                const before = c0s.getState().G.hands['0'].length;
                c0s.moves.draw();
                await waitForState(c0s, st => st.G.hands['0'].length === before + 1);
                equipIdx = c0s.getState().G.hands['0'].findIndex(c => equipSlotOf(c.type) === slot2);
                guard++;
            }
            if (equipIdx !== -1) {
                const card3 = c0s.getState().G.hands['0'][equipIdx];
                const discardBefore2 = cgm.getState().G.discard.length;
                c0s.moves.play(equipIdx);
                await waitForState(cgm, st => st.G.equipment['0'][slot2].id === card3.id);
                const stRep = cgm.getState();
                check('同槽位替换：新装备入栏', stRep.G.equipment['0'][slot2].id === card3.id, stRep.G.equipment['0'][slot2]);
                check('同槽位替换：旧装备进弃牌堆', stRep.G.discard.some(c => c.id === oldCardId), { discarded: stRep.G.discard.map(c => c.id).includes(oldCardId), discardBefore: discardBefore2, discardAfter: stRep.G.discard.length });
            } else {
                console.log('  跳过：手牌无同槽位第二张装备牌');
            }
        } else {
            console.log('  跳过：手牌无第二张装备牌');
        }
    }
}

console.log('== 18. 判定区：乐不思蜀/兵粮寸断/闪电入目标玩家判定区（可重复，明牌） ==');
{
    const c0s = clients[0];
    const isJudgment = c => JUDGMENT_CARDS.includes(c.type);
    let jIdx = c0s.getState().G.hands['0'].findIndex(isJudgment);
    let guard = 0;
    while (jIdx === -1 && guard < 60) {
        const before = c0s.getState().G.hands['0'].length;
        c0s.moves.draw();
        await waitForState(c0s, st => st.G.hands['0'].length === before + 1);
        jIdx = c0s.getState().G.hands['0'].findIndex(isJudgment);
        guard++;
    }
    check('玩家0手牌中找到了判定锦囊', jIdx !== -1, guard);
    if (jIdx !== -1) {
        const card = c0s.getState().G.hands['0'][jIdx];
        const discardBefore = cgm.getState().G.discard.length;
        const handBefore18 = c0s.getState().G.hands['0'].length;
        // 打给玩家1：判定牌应进入玩家1判定区，而非弃牌堆
        c0s.moves.playTargeted(jIdx, '1');
        await waitForState(cgm, st => st.G.judgment && st.G.judgment['1'].length === 1);
        // 等玩家0本地也同步（手牌 -1），后续查找才不会拿到已打出的旧牌
        await waitForState(c0s, st => st.G.hands['0'].length === handBefore18 - 1);
        const stJ1 = cgm.getState();
        check('判定牌进入目标玩家判定区', stJ1.G.judgment['1'].length === 1 && stJ1.G.judgment['1'][0].id === card.id, stJ1.G.judgment['1']);
        check('判定牌未进弃牌堆', stJ1.G.discard.length === discardBefore, { before: discardBefore, after: stJ1.G.discard.length });
        check('GM 能看到判定区（明牌）', stJ1.G.judgment['1'].length === 1, stJ1.G.judgment['1']);
        // 目标玩家也能看到（明牌）
        await waitForState(clients[1], st => st.G.judgment && st.G.judgment['1'].length === 1);
        check('目标玩家能看到自己判定区（明牌）', clients[1].getState().G.judgment['1'].length === 1, clients[1].getState().G.judgment['1']);
        // 再放一张 → 可重复堆叠
        jIdx = c0s.getState().G.hands['0'].findIndex(isJudgment);
        guard = 0;
        while (jIdx === -1 && guard < 60) {
            const before = c0s.getState().G.hands['0'].length;
            c0s.moves.draw();
            await waitForState(c0s, st => st.G.hands['0'].length === before + 1);
            jIdx = c0s.getState().G.hands['0'].findIndex(isJudgment);
            guard++;
        }
        if (jIdx !== -1) {
            const card2 = c0s.getState().G.hands['0'][jIdx];
            c0s.moves.playTargeted(jIdx, '1');
            await waitForState(cgm, st => st.G.judgment['1'].length === 2);
            const stJ2 = cgm.getState();
            check('判定区可重复堆叠（现有 2 张）', stJ2.G.judgment['1'].length === 2 && stJ2.G.judgment['1'][1].id === card2.id, stJ2.G.judgment['1'].map(c => c.type));
        } else {
            console.log('  跳过：手牌无第二张判定锦囊');
        }
    }
}

console.log('== 19. 横置/翻面/判定/判定区取回/铁锁连环 ==');
// 19a. 横置与翻面（toggleTapped / toggleFaceDown）
{
    const c0s = clients[0];
    c0s.moves.toggleTapped();
    await waitForState(cgm, st => st.G.tapped && st.G.tapped['0'] === true);
    check('横置：玩家0 头像横置', cgm.getState().G.tapped['0'] === true, cgm.getState().G.tapped);
    c0s.moves.toggleTapped();
    await waitForState(cgm, st => st.G.tapped['0'] === false);
    check('竖回：玩家0 头像竖回', cgm.getState().G.tapped['0'] === false, cgm.getState().G.tapped);
    c0s.moves.toggleFaceDown();
    await waitForState(cgm, st => st.G.facedown && st.G.facedown['0'] === true);
    check('翻面：玩家0 头像翻面', cgm.getState().G.facedown['0'] === true, cgm.getState().G.facedown);
    c0s.moves.toggleFaceDown();
    await waitForState(cgm, st => st.G.facedown['0'] === false);
    check('翻回：玩家0 头像翻回', cgm.getState().G.facedown['0'] === false, cgm.getState().G.facedown);
}
// 19b. 判定按钮（judge）：翻开牌堆顶并弃掉
{
    const c0s = clients[0];
    const deckBefore = cgm.getState().G.deck.length;
    const discardBefore = cgm.getState().G.discard.length;
    c0s.moves.judge();
    await waitForState(cgm, st => st.G.lastJudged !== undefined && st.G.discard.length === discardBefore + 1);
    const stJ = cgm.getState();
    check('判定：翻开一张牌并弃掉（牌堆 -1）', stJ.G.deck.length === deckBefore - 1, { deck: stJ.G.deck.length, before: deckBefore });
    check('判定：牌进入弃牌堆（弃牌堆 +1）', stJ.G.discard.length === discardBefore + 1, { discard: stJ.G.discard.length, before: discardBefore });
    check('判定：记录最近判定结果（明牌）', stJ.G.lastJudged && stJ.G.lastJudged.card && stJ.G.lastJudged.card.type !== undefined, stJ.G.lastJudged);
}
// 19c. 判定区结算（takeJudgment）：点击判定牌 → 弃入弃牌堆（而非手牌）
{
    const c1 = clients[1];
    const c1j = cgm.getState().G.judgment['1'];
    if (c1j && c1j.length > 0) {
        const discardBefore = cgm.getState().G.discard.length;
        const handBefore = cgm.getState().G.hands['1'].length;
        c1.moves.takeJudgment(0);
        await waitForState(cgm, st => st.G.judgment['1'].length === c1j.length - 1);
        const stT = cgm.getState();
        check('判定区结算：判定区 -1', stT.G.judgment['1'].length === c1j.length - 1, stT.G.judgment['1']);
        check('判定区结算：弃牌堆 +1（弃入弃牌堆）', stT.G.discard.length === discardBefore + 1, { before: discardBefore, after: stT.G.discard.length });
        check('判定区结算：手牌不变（不进手牌）', stT.G.hands['1'].length === handBefore, { before: handBefore, after: stT.G.hands['1'].length });
    } else {
        console.log('  跳过：玩家1判定区无牌可结算');
    }
}
// 19d. 铁锁连环（Chains）不再指向/横置目标：普通打出直接进弃牌堆
{
    const c0s = clients[0];
    const isChains = c => c.type === 'Chains';
    let chIdx = c0s.getState().G.hands['0'].findIndex(isChains);
    let guard = 0;
    while (chIdx === -1 && guard < 60) {
        const before = c0s.getState().G.hands['0'].length;
        c0s.moves.draw();
        await waitForState(c0s, st => st.G.hands['0'].length === before + 1);
        chIdx = c0s.getState().G.hands['0'].findIndex(isChains);
        guard++;
    }
    if (chIdx !== -1) {
        const tappedBefore = cgm.getState().G.tapped['2'] === true;
        const discardBefore = cgm.getState().G.discard.length;
        const handBefore = c0s.getState().G.hands['0'].length;
        c0s.moves.play(chIdx);
        await waitForState(c0s, st => st.G.hands['0'].length === handBefore - 1);
        // 等 GM 客户端也同步到最新（避免读到过期弃牌堆）
        await waitForState(cgm, st => st.G.hands['0'].length === handBefore - 1);
        const stCh = cgm.getState();
        check('铁锁连环：普通打出进弃牌堆', stCh.G.discard.length === discardBefore + 1, { before: discardBefore, after: stCh.G.discard.length });
        check('铁锁连环：不再横置目标玩家（无指向）', (stCh.G.tapped['2'] === true) === tappedBefore, stCh.G.tapped);
    } else {
        console.log('  跳过：手牌无铁锁连环');
    }
}

console.log('== 15. 并发加入（修复 409/丢更新）与 GM 清空玩家 ==');
// 新开一个非 singleton 房间做并发测试，避免影响主房间
const { matchID: m2 } = await lobby.createMatch(SanGuoSha.name, { numPlayers: 5, setupData: { singleton: false } });
const joinResults = await Promise.allSettled([0, 1, 2, 3, 4].map(i =>
    fetch(`${SERVER}/api/join?matchID=${encodeURIComponent(m2)}&playerID=${encodeURIComponent(String(i))}&playerName=${encodeURIComponent('并发' + i)}`, { method: 'POST' })
        .then(r => r.json())
));
check('5 个并发加入全部成功（无 409）',
    joinResults.every(r => r.status === 'fulfilled' && r.value && r.value.status === 200),
    joinResults.map(r => (r.status === 'fulfilled' && r.value) ? r.value.status : 'rejected'));
let { matches: matches2 } = await lobby.listMatches(SanGuoSha.name);
const m2info = matches2.find(x => x.matchID === m2);
check('并发后 5 个座位全部正确占用（无丢更新）',
    m2info !== undefined && m2info.players.every((p, i) => p.name === '并发' + i),
    m2info && m2info.players.map(p => p.name));
// GM 清空玩家
const clearRes = await fetch(`${SERVER}/api/gm/clear-players?matchID=${encodeURIComponent(m2)}`, { method: 'POST' });
check('清空玩家接口成功', clearRes.status === 200);
({ matches: matches2 } = await lobby.listMatches(SanGuoSha.name));
const m2after = matches2.find(x => x.matchID === m2);
check('清空后 5 个座位全部释放', m2after !== undefined && m2after.players.every(p => p.name === undefined), m2after && m2after.players.map(p => p.name));
// 清空后仍可再次加入（座位可复用）
const rejoined = await fetch(`${SERVER}/api/join?matchID=${encodeURIComponent(m2)}&playerID=${encodeURIComponent('0')}&playerName=${encodeURIComponent('重进')}`, { method: 'POST' }).then(r => r.json());
check('清空后座位可重新加入', rejoined.status === 200, rejoined);

console.log('== 16. 图片上传接口（URL 存储，避免 base64 广播放大） ==');
const imgBytes = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46, 0x49, 0x46, 0, 1, 1, 0, 0, 1, 0, 1, 0, 0, 0xff, 0xd9]);
const uploadForm = new FormData();
uploadForm.append('image', new Blob([imgBytes], { type: 'image/jpeg' }), 'avatar.jpg');
uploadForm.append('matchID', m2);
uploadForm.append('playerID', '0');
const upRes = await fetch(`${SERVER}/api/upload`, { method: 'POST', body: uploadForm });
const upData = await upRes.json();
check('上传接口返回 /uploads/ URL', upRes.status === 200 && typeof upData.url === 'string' && upData.url.startsWith('/uploads/'), upData);
if (upData.url) {
    const getRes = await fetch(`${SERVER}${upData.url}`);
    check('上传的图片可访问', getRes.status === 200, getRes.status);
}

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
