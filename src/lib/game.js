import setup from './setup.js';
import { drawCard, drawCards, discard } from './helper.js';

/* Moves */

function draw(G, ctx) {
    const { hands } = G;
    const { playerID } = ctx;
    const card = drawCard(G, ctx);
    if (card !== undefined) {
        hands[playerID].push(card);
    }
}

function play(G, ctx, index) {
    const { hands } = G;
    const { playerID } = ctx;
    const [card] = hands[playerID].splice(index, 1);
    if (card === undefined) {
        return;
    }
    discard(G, ctx, card);
}

function pickUp(G, ctx, index) {
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

function updateMaxHealth(G, ctx, change) {
    const { healths } = G;
    const { playerID } = ctx;
    healths[playerID].max += change;
    if (healths[playerID].max < 1) {
        healths[playerID].max = 1;
    }
    if (healths[playerID].max > 10) {
        healths[playerID].max = 10;
    }
    if (healths[playerID].current > healths[playerID].max) {
        healths[playerID].current = healths[playerID].max;
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
                    // 自由模式：所有玩家都可以随时出牌
                    events.setActivePlayers({ all: 'play' });
                },
                stages: {
                    play: {
                        moves: {
                            draw,
                            play,
                            pickUp,
                            dismantle,
                            steal,
                            setImage,
                            updateHealth,
                            updateMaxHealth,
                            endPlay,
                        },
                    },
                    discard: {
                        moves: { pickUp, discardCard, finishDiscard, setImage },
                    },
                },
            },
        },
    },

    minPlayers: 5,

    maxPlayers: 5,
};
