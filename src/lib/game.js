import setup from './setup.js';
import { drawCard, drawCards, discard } from './helper.js';

// 需要指向目标的卡牌（杀、部分锦囊牌）
export const TARGETED_CARDS = ['Attack', 'Duel', 'Dismantle', 'Steal', 'Fire Attack', 'Capture', 'Starvation', 'Lightning'];

// 身份牌中文名
export const ROLE_LABELS = { King: '主公', Rebel: '反贼', Loyalist: '忠臣', Spy: '内奸' };

// 5 人局身份分布：1 主公、2 反贼、1 忠臣、1 内奸
const ROLE_POOL_5 = ['King', 'Rebel', 'Rebel', 'Loyalist', 'Spy'];

const MAX_TARGETS_KEPT = 8;

/* Moves */

function draw(G, ctx) {
    if (!G.rolesDealt) return;
    const { hands } = G;
    const { playerID } = ctx;
    const card = drawCard(G, ctx);
    if (card !== undefined) {
        hands[playerID].push(card);
    }
}

function play(G, ctx, index) {
    if (!G.rolesDealt) return;
    const { hands } = G;
    const { playerID } = ctx;
    const [card] = hands[playerID].splice(index, 1);
    if (card === undefined) {
        return;
    }
    discard(G, ctx, card);
}

// 打出需要目标的卡牌：记录“谁用【什么】指向了谁”，所有人（含 GM）可见
function playTargeted(G, ctx, index, targetPlayerID) {
    if (!G.rolesDealt) return;
    const { hands } = G;
    const { playerID } = ctx;
    const [card] = hands[playerID].splice(index, 1);
    if (card === undefined) {
        return;
    }
    discard(G, ctx, card);
    if (TARGETED_CARDS.includes(card.type) && targetPlayerID !== undefined) {
        const targets = G.targets || [];
        targets.push({
            id: G.targetSeq || 0,
            source: playerID,
            target: targetPlayerID,
            cardType: card.type,
            cardId: card.id,
        });
        G.targetSeq = (G.targetSeq || 0) + 1;
        if (targets.length > MAX_TARGETS_KEPT) {
            targets.splice(0, targets.length - MAX_TARGETS_KEPT);
        }
        G.targets = targets;
    }
}

function pickUp(G, ctx, index) {
    if (!G.rolesDealt) return;
    const { discard, hands } = G;
    const { playerID } = ctx;
    const [card] = discard.splice(index, 1);
    if (card === undefined) {
        return;
    }
    hands[playerID].push(card);
}

// 过河拆桥：从目标玩家手牌中弃掉一张牌
function dismantle(G, ctx, target) {
    if (!G.rolesDealt) return;
    const { hands } = G;
    if (target && target.index !== undefined) {
        const [card] = hands[target.playerID].splice(target.index, 1);
        if (card !== undefined) {
            discard(G, ctx, card);
        }
    }
}

// 顺手牵羊：把目标玩家手牌中的一张牌拿到自己手里
function steal(G, ctx, target) {
    if (!G.rolesDealt) return;
    const { hands } = G;
    const { playerID } = ctx;
    if (target && target.index !== undefined) {
        const [card] = hands[target.playerID].splice(target.index, 1);
        if (card !== undefined) {
            hands[playerID].push(card);
        }
    }
}

function updateHealth(G, ctx, change) {
    const { healths } = G;
    const { playerID } = ctx;
    healths[playerID].current += change;
    if (healths[playerID].current > healths[playerID].max) {
        healths[playerID].current = healths[playerID].max;
    }
    if (healths[playerID].current < 0) {
        healths[playerID].current = 0;
    }
}

// 玩家自行输入体力上限（D&D 等大数值），设定后视为满血
function setMaxHealth(G, ctx, value) {
    const { healths } = G;
    const { playerID } = ctx;
    const num = parseInt(value, 10);
    if (!isFinite(num)) {
        return;
    }
    const max = Math.max(1, Math.min(9999, num));
    healths[playerID].max = max;
    healths[playerID].current = max;
}

// 上传玩家自己的图片（dataURL 存入游戏状态，所有玩家与 GM 可见）
function setImage(G, ctx, imageData) {
    const { playerImages } = G;
    const { playerID } = ctx;
    if (typeof imageData === 'string') {
        playerImages[playerID] = imageData;
    }
}

// 就位 / 取消就位
function ready(G, ctx) {
    if (G.rolesDealt) return;
    const { playerID } = ctx;
    const readyMap = G.ready || (G.ready = {});
    readyMap[playerID] = !readyMap[playerID];
}

// GM 专属：全员就位后发身份牌（1 主公 / 2 反贼 / 1 忠臣 / 1 内奸）
function dealRoles(G, ctx) {
    if (G.rolesDealt) return;
    const { playOrder } = ctx;
    const readyMap = G.ready || {};
    const allReady = playOrder.every(p => readyMap[p] === true);
    if (!allReady) return;
    const shuffled = ctx.random.Shuffle([...ROLE_POOL_5]);
    const roles = {};
    playOrder.forEach((p, i) => { roles[p] = shuffled[i]; });
    G.roles = roles;
    G.rolesDealt = true;
}

// 当前回合玩家：把回合主动交给主公，并公开主公身份
function revealKingAndHandTurn(G, ctx) {
    const { roles, kingRevealed } = G;
    if (kingRevealed || !G.rolesDealt) return;
    const { playerID, currentPlayer, events, playOrder } = ctx;
    if (playerID !== currentPlayer) return;
    const king = playOrder.find(p => roles[p] === 'King');
    if (king === undefined) return;
    G.kingRevealed = true;
    events.endTurn({ next: king });
}

// GM 专属：一键清空房间、重新开局（保留玩家上传的图片与体力上限）
function gmReset(G, ctx) {
    const { playerImages, healths } = G;
    const fresh = setup(ctx);
    fresh.playerImages = playerImages;
    const { playOrder } = ctx;
    playOrder.forEach(player => {
        const prev = healths[player];
        const max = prev && prev.max > 0 ? prev.max : fresh.healths[player].max;
        fresh.healths[player].max = max;
        fresh.healths[player].current = max;
    });
    G.deck = fresh.deck;
    G.discard = fresh.discard;
    G.hands = fresh.hands;
    G.healths = fresh.healths;
    G.playerImages = playerImages;
    G.ready = fresh.ready;
    G.roles = fresh.roles;
    G.rolesDealt = fresh.rolesDealt;
    G.kingRevealed = fresh.kingRevealed;
    G.targets = fresh.targets;
    G.targetSeq = fresh.targetSeq;
    playOrder.forEach(player => drawCards(G, ctx, player, 4));
}

function endPlay(G, ctx) {
    const { healths, hands } = G;
    const { currentPlayer, events, playerID } = ctx;
    if (currentPlayer === playerID) {
        events.setStage('discard');
        if (hands[playerID].length <= healths[playerID].current) {
            events.endTurn();
        }
    }
}

function discardCard(G, ctx, index) {
    const { healths, hands } = G;
    const { events, playerID } = ctx;
    const [card] = hands[playerID].splice(index, 1);
    if (card === undefined) {
        return;
    }
    discard(G, ctx, card);
    if (hands[playerID].length <= healths[playerID].current) {
        events.endTurn();
    }
}

function finishDiscard(_G, ctx) {
    const { currentPlayer, events, playerID } = ctx;
    if (currentPlayer === playerID) {
        events.endTurn();
    }
}

/* Game object */

const turnOrder = {
    first: () => 0,
    next: (_G, ctx) => (ctx.playOrderPos + 1) % ctx.numPlayers,
};

export const SanGuoSha = {
    name: "san-guo-sha",

    setup,

    // 身份牌只对本人与 GM 可见；主公展示后对所有人可见
    playerView: (G, ctx, playerID) => {
        if (playerID === '-1' || !G.rolesDealt) {
            return G;
        }
        const { roles } = G;
        if (!roles) {
            return G;
        }
        const newRoles = { ...roles };
        const { playOrder } = ctx;
        playOrder.forEach(p => {
            if (p !== playerID && !(G.kingRevealed && newRoles[p] === 'King')) {
                newRoles[p] = 'hidden';
            }
        });
        return { ...G, roles: newRoles };
    },

    phases: {
        play: {
            start: true,

            onBegin: (G, ctx) => {
                const { playOrder } = ctx;
                playOrder.forEach(player => drawCards(G, ctx, player, 4));
            },

            turn: {
                order: turnOrder,
                onBegin: (_G, ctx) => {
                    const { events } = ctx;
                    // 自由模式：所有玩家都可以随时出牌；GM（旁观者 -1）进入专属 gm 阶段，只能执行 GM 操作
                    events.setActivePlayers({ all: 'play', value: { '-1': 'gm' } });
                },
                stages: {
                    play: {
                        moves: {
                            draw,
                            play,
                            playTargeted,
                            pickUp,
                            dismantle,
                            steal,
                            // 以下按玩家独立的操作忽略过期 stateID，避免多人同时操作时被拒
                            setImage: { move: setImage, ignoreStaleStateID: true },
                            setMaxHealth: { move: setMaxHealth, ignoreStaleStateID: true },
                            updateHealth: { move: updateHealth, ignoreStaleStateID: true },
                            ready: { move: ready, ignoreStaleStateID: true },
                            revealKingAndHandTurn,
                            endPlay,
                        },
                    },
                    discard: {
                        moves: {
                            pickUp,
                            discardCard,
                            finishDiscard,
                            setImage: { move: setImage, ignoreStaleStateID: true },
                        },
                    },
                    gm: {
                        moves: { dealRoles, gmReset },
                    },
                },
            },
        },
    },

    minPlayers: 5,

    maxPlayers: 5,
};
