import setup from './setup.js';
import { drawCard, drawCards, discard } from './helper.js';

// 需要指向目标的卡牌（杀、部分锦囊牌）
export const TARGETED_CARDS = ['Attack', 'Duel', 'Dismantle', 'Steal', 'Fire Attack', 'Capture', 'Starvation', 'Lightning'];

// 装备牌分类（三国杀标准）
export const WEAPON_TYPES = ['Crossbow', 'Fire Fan', 'Axe', 'Longbow', 'Green Dragon Blade', 'Serpent Spear', 'Ice Sword', 'Ancient Scimitar', 'Gender Swords', 'Black Pommel', 'Sky Scorcher'];
export const ARMOR_TYPES = ['Eight Trigrams', 'Silver Helmet', 'Black Shield', 'Wood Armor'];
export const OFFENSIVE_HORSE_TYPES = ['Red Hare', 'Da Yuan', 'Zi Xing'];   // 进攻马（-1 马）
export const DEFENSIVE_HORSE_TYPES = ['Di Lu', 'Storm Runner', 'Shadow Runner', 'Hua Liu']; // 防御马（+1 马）

// 装备槽位顺序（前端渲染与后端存储共用）
export const EQUIP_SLOT_ORDER = ['weapon', 'armor', 'defHorse', 'offHorse'];
export const EQUIP_SLOT_LABELS = { weapon: '武器', armor: '护甲', defHorse: '防御马', offHorse: '进攻马' };

// 卡牌类型 → 装备槽位（非装备牌返回 undefined）
export function equipSlotOf(type) {
    if (WEAPON_TYPES.includes(type)) return 'weapon';
    if (ARMOR_TYPES.includes(type)) return 'armor';
    if (DEFENSIVE_HORSE_TYPES.includes(type)) return 'defHorse';
    if (OFFENSIVE_HORSE_TYPES.includes(type)) return 'offHorse';
    return undefined;
}

// 身份牌中文名
export const ROLE_LABELS = { King: '主公', Rebel: '反贼', Loyalist: '忠臣', Spy: '内奸' };

// 5 人局身份分布：1 主公、2 反贼、1 忠臣、1 内奸
const ROLE_POOL_5 = ['King', 'Rebel', 'Rebel', 'Loyalist', 'Spy'];

// 策划 §1.2（用户版）：主公展示时自动附加的血量上限加成
const KING_HP_BONUS = 30;

// 手牌上限随生命分段动态变化（策划 §1.1）：健康(>50%)→4，受伤(25~50%)→2，重伤(≤25%)→1；主公额外+1
function handLimitOf(G, playerID) {
    const h = G.healths && G.healths[playerID];
    if (!h || h.max <= 0) {
        return 1;
    }
    const ratio = h.current / h.max;
    let limit = ratio > 0.5 ? 4 : (ratio > 0.25 ? 2 : 1);
    if (G.roles && G.roles[playerID] === 'King') {
        limit += 1;
    }
    return limit;
}

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
    const slot = equipSlotOf(card.type);
    const eq = G.equipment && G.equipment[playerID];
    if (slot !== undefined && eq) {
        // 装备牌：放入装备栏（同槽位旧装备进弃牌堆），而非弃牌堆
        if (eq[slot]) {
            discard(G, ctx, eq[slot]);
        }
        eq[slot] = card;
    } else {
        discard(G, ctx, card);
    }
    // 打出牌后，上一条指向连线消失（连线只表示最近一次行动）
    G.targets = [];
}

// 拖拽装备：按牌 id 从手牌装备到装备栏（仅装备牌有效）
function equipByCardId(G, ctx, cardId) {
    if (!G.rolesDealt) return;
    const { hands } = G;
    const { playerID } = ctx;
    const idx = hands[playerID].findIndex(c => c.id === cardId);
    if (idx === -1) return;
    const card = hands[playerID][idx];
    if (equipSlotOf(card.type) === undefined) return;
    play(G, ctx, idx);
}

// 拖出/取下装备：装备栏中的牌弃到弃牌堆（扔到桌子上）
function unequip(G, ctx, slot) {
    if (!G.rolesDealt) return;
    const { playerID } = ctx;
    const eq = G.equipment && G.equipment[playerID];
    if (!eq || !eq[slot]) return;
    discard(G, ctx, eq[slot]);
    eq[slot] = undefined;
    G.targets = [];
}

// 打出需要目标的卡牌：记录“谁用【什么】指向了谁”，所有人（含 GM）可见；
// 只保留最近一条（打出下一张牌后旧连线消失/被替换）
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
        G.targets = [{
            id: G.targetSeq || 0,
            source: playerID,
            target: targetPlayerID,
            cardType: card.type,
            cardId: card.id,
        }];
        G.targetSeq = (G.targetSeq || 0) + 1;
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

// 分别设置当前 HP 与 HP 上限（点击 HP 标签后弹出输入框，可只填其一）
function setHealth(G, ctx, value) {
    const { healths } = G;
    const { playerID } = ctx;
    const h = healths[playerID];
    if (!h) return;
    const v = value || {};
    if (v.max !== undefined && v.max !== null && v.max !== '') {
        const max = Math.max(1, Math.min(9999, parseInt(v.max, 10)));
        if (isFinite(max)) {
            h.max = max;
        }
    }
    if (v.current !== undefined && v.current !== null && v.current !== '') {
        const cur = Math.max(0, Math.min(h.max, parseInt(v.current, 10)));
        if (isFinite(cur)) {
            h.current = cur;
        }
    } else {
        // 只改上限时，当前值钳制到新上限内
        if (h.current > h.max) {
            h.current = h.max;
        }
    }
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

// 当前回合玩家：把回合主动交给主公，并公开主公身份；展示时自动附加主公血量加成（+30）
function revealKingAndHandTurn(G, ctx) {
    const { roles, kingRevealed } = G;
    if (kingRevealed || !G.rolesDealt) return;
    const { playerID, currentPlayer, events, playOrder } = ctx;
    if (playerID !== currentPlayer) return;
    const king = playOrder.find(p => roles[p] === 'King');
    if (king === undefined) return;
    G.kingRevealed = true;
    // 主公血量加成（策划 §1.2：龙城卡血量 +30），仅应用一次
    if (!G.kingBonusApplied && G.healths[king]) {
        G.healths[king].max += KING_HP_BONUS;
        G.healths[king].current = G.healths[king].max;
        G.kingBonusApplied = true;
    }
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
    G.kingBonusApplied = false;
    G.targets = fresh.targets;
    G.targetSeq = fresh.targetSeq;
    G.equipment = fresh.equipment;
    playOrder.forEach(player => drawCards(G, ctx, player, 4));
}

function endPlay(G, ctx) {
    const { hands } = G;
    const { currentPlayer, events, playerID } = ctx;
    if (currentPlayer === playerID) {
        events.setStage('discard');
        if (hands[playerID].length <= handLimitOf(G, playerID)) {
            events.endTurn();
        }
    }
}

function discardCard(G, ctx, index) {
    const { hands } = G;
    const { events, playerID } = ctx;
    const [card] = hands[playerID].splice(index, 1);
    if (card === undefined) {
        return;
    }
    discard(G, ctx, card);
    if (hands[playerID].length <= handLimitOf(G, playerID)) {
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
                            equipByCardId,
                            unequip,
                            pickUp,
                            dismantle,
                            steal,
                            // 以下按玩家独立的操作忽略过期 stateID，避免多人同时操作时被拒
                            setImage: { move: setImage, ignoreStaleStateID: true },
                            setMaxHealth: { move: setMaxHealth, ignoreStaleStateID: true },
                            setHealth: { move: setHealth, ignoreStaleStateID: true },
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
