/**
 * 线上清理：把所有"单例房间"清空座位 + 重置对局（GM gmReset）。
 * 用于清除关闭标签页留下的幽灵占位（导致后续玩家加不进房间）。
 * 运行：node scripts/cleanup-prod.mjs
 */
import { Client } from 'boardgame.io/dist/cjs/client.js';
import { SocketIO } from 'boardgame.io/dist/cjs/multiplayer.js';
import { LobbyClient } from 'boardgame.io/dist/cjs/client.js';
import { SanGuoSha } from '../src/lib/game.js';

const SERVER = 'https://sanguo.zeabur.app';
const sleep = ms => new Promise(r => setTimeout(r, ms));

const lobby = new LobbyClient({ server: SERVER });
const { matches } = await lobby.listMatches(SanGuoSha.name);
const singletons = matches.filter(m => m.setupData && m.setupData.singleton === true && !m.gameover);
console.log(`单例房间数: ${singletons.length}`);

for (const m of singletons) {
    const occupied = m.players.filter(p => p.name).map(p => p.name);
    console.log(`- ${m.matchID} 当前座位: ${occupied.length ? occupied.join(',') : '空'}`);
    // 1) 清空座位
    const res = await fetch(`${SERVER}/api/gm/clear-players?matchID=${encodeURIComponent(m.matchID)}`, { method: 'POST' });
    console.log(`  清座位: HTTP ${res.status}`);
    // 2) 重置对局（GM gmReset）——先等同步完成，再发 move
    const cgm = Client({ game: SanGuoSha, multiplayer: SocketIO({ server: SERVER }), matchID: m.matchID, playerID: '-1' });
    cgm.start();
    let synced = false;
    for (let k = 0; k < 60; k++) {
        await sleep(200);
        const st = cgm.getState();
        if (st && st.G && st.ctx) { synced = true; break; }
    }
    if (!synced) {
        console.log('  GM 同步超时，跳过重置');
        cgm.stop();
        continue;
    }
    try {
        cgm.moves.gmReset();
        let reset = false;
        for (let k = 0; k < 40; k++) {
            await sleep(200);
            const st = cgm.getState();
            if (st && st.G && st.G.rolesDealt === false && st.G.hands['0'] && st.G.hands['0'].length === 4) {
                reset = true;
                break;
            }
        }
        console.log(reset ? '  对局已重置（回到未发牌状态）' : '  对局重置未确认');
    } catch (e) {
        console.log('  对局重置失败:', e.message);
    }
    cgm.stop();
    await sleep(500);
}

// 复查
const { matches: after } = await lobby.listMatches(SanGuoSha.name);
const singles = after.filter(m => m.setupData && m.setupData.singleton === true && !m.gameover);
for (const m of singles) {
    const occupied = m.players.filter(p => p.name).map(p => p.name);
    console.log(`清理后 ${m.matchID} 座位: ${occupied.length ? occupied.join(',') : '全部空'}`);
}
console.log('✅ 清理完成');
