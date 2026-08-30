import * as classNames from 'classnames';
import React from 'react';
import SetModePanel from './setModePanel';
import AnimatedBoard from './animatedBoard';
import { TARGETED_CARDS, ROLE_LABELS, EQUIP_SLOT_ORDER, EQUIP_SLOT_LABELS, equipSlotOf } from '../lib/game.js';
import './gameArea.css';

// 卡牌类型中文名（用于指向箭头上的文字）
const CARD_CN = {
    'Attack': '杀',
    'Duel': '决斗',
    'Dismantle': '过河拆桥',
    'Steal': '顺手牵羊',
    'Fire Attack': '火攻',
    'Capture': '乐不思蜀',
    'Starvation': '兵粮寸断',
    'Lightning': '闪电',
};

// 装备牌中文名（装备栏内明牌显示）
const EQUIP_CN = {
    'Crossbow': '诸葛连弩',
    'Fire Fan': '朱雀羽扇',
    'Axe': '贯石斧',
    'Longbow': '麒麟弓',
    'Green Dragon Blade': '青龙偃月刀',
    'Serpent Spear': '丈八蛇矛',
    'Ice Sword': '寒冰剑',
    'Ancient Scimitar': '古锭刀',
    'Gender Swords': '雌雄双股剑',
    'Black Pommel': '青釭剑',
    'Sky Scorcher': '方天画戟',
    'Eight Trigrams': '八卦阵',
    'Silver Helmet': '白银狮子',
    'Black Shield': '仁王盾',
    'Wood Armor': '藤甲',
    'Red Hare': '赤兔',
    'Da Yuan': '大宛',
    'Zi Xing': '紫骍',
    'Di Lu': '的卢',
    'Storm Runner': '绝影',
    'Shadow Runner': '爪黄飞电',
    'Hua Liu': '骅骝',
};

// Standard margin between objects
const DELTA = 10;

// Number of pixels between info objects inside the player card to the player card's border
const INFO_DELTA = 4;

// Ratio of other player hand cards to normal cards
const CARD_RATIO = 0.3;

// Ratio of cards in the deck to normal cards
const DECK_RATIO = 0.5;

// Ratio of cards in the middle to normal cards
const MIDDLE_CARD_RATIO = 0.7;

// Uploaded images are downscaled to at most this many pixels on the long side
const IMAGE_MAX_SIZE = 512;

export default class GameArea extends React.Component {

    constructor(props) {
        super(props);
        this.state = {
            mode: SetModePanel.DEFAULT_MODE,
            uploadTarget: undefined,
            editingHp: false,
            hpEditCurrent: '',
            hpEditMax: '',
            draggingCardId: undefined, // 当前拖拽的手牌 id
        };
    }

    componentDidUpdate() {
        const { G, ctx, events, moves } = this.props;
        window.sanguosha = { G, ctx, events, moves };
    }

    render() {
        const { ctx, playerID, width, height, playerAreas, scaledWidth, scaledHeight } = this.props;
        const { numPlayers, playOrder, currentPlayer } = ctx;
        const isGM = playerID === '-1';

        const characterCards = [];
        const normalCards = [];
        const nodes = [];

        const myPlayerIndex = Math.max(playOrder.indexOf(playerID), 0);
        playerAreas.forEach((playerArea, i) => {
            const playerIndex = (myPlayerIndex + i) % numPlayers;
            const player = playOrder[playerIndex];
            const isMe = player === playerID;

            this.addPlayerName(playerArea, playerIndex, player, nodes);
            this.addPlayerImage(playerArea, player, isMe, characterCards);
            this.addHealth(playerArea, player, isMe, nodes);
            this.addEquipment(playerArea, player, isMe, nodes);
            this.addRoleBadge(playerArea, player, isMe, nodes);
            if (player === currentPlayer) {
                // 当前回合玩家：金色框框高亮（所有人可见，含 GM）
                nodes.push(<div
                    key={`turn-frame-${player}`}
                    className='positioned current-player-frame'
                    style={{
                        left: playerArea.x - 4,
                        top: playerArea.y - 4,
                        width: scaledWidth + 8,
                        height: scaledHeight + 8,
                    }}
                />);
            }
            if (isGM || !isMe) {
                this.addOtherPlayerHand(playerArea, player, normalCards, nodes, isGM);
            }
        });

        this.addDeck(normalCards);
        this.addMyHand(normalCards);
        this.addDiscard(normalCards);

        return <div
            onDragOver={this.onBoardDragOver}
            onDrop={this.onBoardDrop}
        >
            {this.renderMyArea()}
            <AnimatedBoard
                width={width}
                height={height}
                scaledWidth={scaledWidth}
                scaledHeight={scaledHeight}
                characterCards={characterCards}
                normalCards={normalCards}
            />
            {nodes}
            {this.renderTargetArrows()}
            {this.renderActionButton()}
            {this.renderSetModePanel()}
            {this.renderGMActions()}
            {this.renderUploadInput()}
            {this.renderTurnBanner()}
            {this.renderHpEditor()}
        </div>;
    }

    renderTurnBanner() {
        const { ctx, playerID, matchData } = this.props;
        if (playerID === '-1') {
            // GM 顶部已显示 GM 横幅，不再叠加
            return undefined;
        }
        const { currentPlayer, playOrder } = ctx;
        const idx = playOrder.indexOf(currentPlayer);
        const name = matchData && matchData[idx] && matchData[idx].name
            ? matchData[idx].name
            : `玩家 ${currentPlayer}`;
        return <div className='turn-banner'>
            {`当前回合：${name}`}
        </div>;
    }

    renderGMActions() {
        const { G, ctx, playerID, moves } = this.props;
        if (playerID !== '-1') {
            return undefined;
        }
        const { ready, rolesDealt } = G;
        const readyMap = ready || {};
        const { playOrder } = ctx;
        const readyCount = playOrder.filter(p => readyMap[p] === true).length;
        const allReady = readyCount === playOrder.length;
        let dealButton = undefined;
        if (allReady && !rolesDealt) {
            dealButton = <button
                className='gm-deal'
                onClick={() => moves.dealRoles()}
            >
                {'发身份牌'}
            </button>;
        }
        return <div className='gm-actions'>
            <div className='gm-status'>
                {rolesDealt
                    ? '身份牌已发放（仅 GM 与本人可见）'
                    : `就位 ${readyCount}/${playOrder.length}${allReady ? '，可发身份牌' : ''}`}
            </div>
            {dealButton}
            <button
                className='gm-kick'
                onClick={async () => {
                    if (window.confirm('确认清空所有玩家？\n所有座位将被释放，对局一并重置（玩家需重新就位、GM 重新发身份牌）。')) {
                        try {
                            await fetch(`/api/gm/clear-players?matchID=${encodeURIComponent(this.props.matchID)}`, { method: 'POST' });
                        } catch (e) {
                            // 座位清空失败不阻塞对局重置
                        }
                        moves.gmReset();
                    }
                }}
            >
                {'清空玩家（释放所有座位）'}
            </button>
            <button
                className='gm-reset'
                onClick={() => {
                    if (window.confirm('确认清空房间、重新开局？\n将清空所有手牌与弃牌、重新洗牌、体力回满（保留玩家图片与体力上限）。')) {
                        moves.gmReset();
                    }
                }}
            >
                {'清空房间（重新开局）'}
            </button>
        </div>;
    }

    addPlayerName(playerArea, playerIndex, player, nodes) {
        const { ctx, matchData, scaledWidth, scaledHeight } = this.props;
        const { currentPlayer } = ctx;
        if (matchData !== undefined) {
            nodes.push(<div
                key={`name-${playerIndex}`}
                className={classNames('positioned player-name', { 'current-player': currentPlayer === player })}
                style={{
                    left: playerArea.x + INFO_DELTA,
                    top: playerArea.y + scaledHeight + INFO_DELTA,
                    width: scaledWidth - 2 * INFO_DELTA,
                    height: scaledHeight * 0.2,
                }}
            >
                {matchData[playerIndex] ? matchData[playerIndex].name : player}
            </div>);
        }
    }

    addPlayerImage(playerArea, player, isMe, characterCards) {
        const { G, moves, scaledWidth, scaledHeight } = this.props;
        const { playerImages } = G;
        const { mode, selectedIndex } = this.state;
        const image = playerImages[player];

        let onClick = undefined;
        let placeholderText = undefined;
        if (mode === SetModePanel.TARGET_MODE && selectedIndex !== undefined && !isMe) {
            // 选择卡牌目标：点击目标玩家
            onClick = () => {
                moves.playTargeted(selectedIndex, player);
                this.setState({ mode: SetModePanel.DEFAULT_MODE, selectedIndex: undefined });
            };
        } else if (image === undefined) {
            placeholderText = isMe ? '点击上传图片' : '未上传';
            if (isMe && mode === SetModePanel.DEFAULT_MODE) {
                onClick = () => {
                    this.setState({ uploadTarget: player }, () => {
                        if (this.fileInput) {
                            this.fileInput.click();
                        }
                    });
                };
            }
        } else if (isMe && mode === SetModePanel.DEFAULT_MODE) {
            // 点击自己的图片可以更换
            onClick = () => {
                this.setState({ uploadTarget: player }, () => {
                    if (this.fileInput) {
                        this.fileInput.click();
                    }
                });
            };
        }

        characterCards.push({
            key: `image-${player}`,
            src: image,
            placeholderText,
            opacity: 1,
            left: playerArea.x,
            top: playerArea.y,
            width: scaledWidth,
            height: scaledHeight,
            onClick,
        });
    }

    addHealth(playerArea, player, isMe, nodes) {
        const { G, moves, scaledWidth, scaledHeight } = this.props;
        const { healths } = G;
        const health = healths[player];
        const labelWidth = scaledWidth * 0.3;
        const labelHeight = scaledHeight * 0.08;

        // 生命分段（策划 §1.1）：>50% 健康 / 25~50% 受伤 / ≤25% 重伤
        const ratio = health.max > 0 ? health.current / health.max : 0;
        const healthClass = ratio > 0.5 ? 'health-ok' : (ratio > 0.25 ? 'health-warn' : 'health-danger');
        // 手牌上限随生命分段动态变化（健康4/受伤2/重伤1，主公+1）
        let handLimit = ratio > 0.5 ? 4 : (ratio > 0.25 ? 2 : 1);
        if (G.roles && G.roles[player] === 'King') {
            handLimit += 1;
        }

        // 自己的 HP 标签可点击，点击后弹出编辑框（当前 HP / 上限分别输入）
        const editable = isMe;
        nodes.push(<div
            key={`hp-${player}`}
            className={classNames('positioned hp-label', healthClass, { 'hp-label-editable': editable })}
            style={{
                left: playerArea.x + INFO_DELTA,
                top: playerArea.y + INFO_DELTA,
                width: labelWidth,
                height: labelHeight,
                fontSize: scaledHeight * 0.05,
            }}
            onClick={editable ? () => this.openHpEditor(player) : undefined}
        >
            {`HP ${health.current}/${health.max}`}
        </div>);
        nodes.push(<div
            key={`hl-${player}`}
            className='positioned hand-limit-badge'
            style={{
                left: playerArea.x + INFO_DELTA + labelWidth + 2,
                top: playerArea.y + INFO_DELTA,
                width: labelWidth * 0.75,
                height: labelHeight,
                fontSize: scaledHeight * 0.045,
            }}
        >
            {`手牌上限 ${handLimit}`}
        </div>);

        if (isMe) {
            const btnWidth = scaledWidth * 0.12;
            const btnHeight = labelHeight * 0.8;
            const rowTop = playerArea.y + INFO_DELTA + labelHeight;
            nodes.push(<button
                key='hp-minus'
                className='positioned hp-btn'
                style={{
                    left: playerArea.x + INFO_DELTA,
                    top: rowTop,
                    width: btnWidth,
                    height: btnHeight,
                    fontSize: scaledHeight * 0.045,
                }}
                onClick={() => moves.updateHealth(-1)}
            >
                {'-'}
            </button>);
            nodes.push(<button
                key='hp-plus'
                className='positioned hp-btn'
                style={{
                    left: playerArea.x + INFO_DELTA + btnWidth + INFO_DELTA,
                    top: rowTop,
                    width: btnWidth,
                    height: btnHeight,
                    fontSize: scaledHeight * 0.045,
                }}
                onClick={() => moves.updateHealth(1)}
            >
                {'+'}
            </button>);
        }
    }

    // 点击 HP 标签：弹出编辑框（当前 HP 与上限分别输入），输入框加大
    openHpEditor(player) {
        const { G } = this.props;
        const health = G.healths[player];
        this.setState({
            editingHp: true,
            hpEditCurrent: String(health.current),
            hpEditMax: String(health.max),
        });
    }

    closeHpEditor() {
        this.setState({ editingHp: false });
    }

    submitHpEditor() {
        const { moves } = this.props;
        moves.setHealth({
            current: this.state.hpEditCurrent,
            max: this.state.hpEditMax,
        });
        this.closeHpEditor();
    }

    renderHpEditor() {
        if (!this.state.editingHp) {
            return undefined;
        }
        return <div className='hp-editor-overlay'>
            <div className='hp-editor'>
                <div className='hp-editor-title'>{'设置 HP'}</div>
                <div className='hp-editor-row'>
                    <div className='hp-editor-field'>
                        <div className='hp-editor-label'>{'当前 HP'}</div>
                        <input
                            className='hp-editor-input'
                            type="number"
                            min="0"
                            autoFocus
                            value={this.state.hpEditCurrent}
                            onChange={e => this.setState({ hpEditCurrent: e.target.value })}
                            onKeyPress={e => {
                                if (e.nativeEvent.key === 'Enter') {
                                    this.submitHpEditor();
                                }
                            }}
                        />
                    </div>
                    <div className='hp-editor-field'>
                        <div className='hp-editor-label'>{'上限'}</div>
                        <input
                            className='hp-editor-input'
                            type="number"
                            min="1"
                            value={this.state.hpEditMax}
                            onChange={e => this.setState({ hpEditMax: e.target.value })}
                            onKeyPress={e => {
                                if (e.nativeEvent.key === 'Enter') {
                                    this.submitHpEditor();
                                }
                            }}
                        />
                    </div>
                </div>
                <div className='hp-editor-actions'>
                    <button className='hp-editor-btn hp-editor-ok' onClick={() => this.submitHpEditor()}>
                        {'确定'}
                    </button>
                    <button className='hp-editor-btn hp-editor-cancel' onClick={() => this.closeHpEditor()}>
                        {'取消'}
                    </button>
                </div>
            </div>
        </div>;
    }

    // 装备栏：自己的竖排在头像左侧（4 格），其他人的横排在头像下方
    // 装备牌对所有人明牌（含 GM）；只有本人可拖入/拖出
    addEquipment(playerArea, player, isMe, nodes) {
        const { G, moves, scaledWidth, scaledHeight } = this.props;
        const eq = G.equipment && G.equipment[player];
        if (!eq) {
            return;
        }
        const slotWidth = scaledWidth * 0.34;
        const slotHeight = scaledHeight * 0.14;
        const gap = 3;
        let left, top, dx, dy;
        if (isMe) {
            // 自己的头像在右下角：装备栏竖排到头像左侧（不超出屏幕、不被底部手牌区遮挡）
            const totalHeight = slotHeight * EQUIP_SLOT_ORDER.length + gap * (EQUIP_SLOT_ORDER.length - 1);
            left = playerArea.x - slotWidth - 6;
            top = playerArea.y + (scaledHeight - totalHeight) / 2;
            dx = 0;
            dy = slotHeight + gap;
        } else {
            const totalWidth = slotWidth * EQUIP_SLOT_ORDER.length + gap * (EQUIP_SLOT_ORDER.length - 1);
            left = playerArea.x + (scaledWidth - totalWidth) / 2;
            top = playerArea.y + scaledHeight + INFO_DELTA + scaledHeight * 0.2 + 4;
            dx = slotWidth + gap;
            dy = 0;
        }

        EQUIP_SLOT_ORDER.forEach((slot, i) => {
            const card = eq[slot];
            const draggable = isMe && card !== undefined;
            nodes.push(<div
                key={`eq-${player}-${slot}`}
                className={classNames('positioned equip-slot', { 'equip-filled': card !== undefined, 'equip-self': isMe })}
                style={{
                    left: left + dx * i,
                    top: top + dy * i,
                    width: slotWidth,
                    height: slotHeight,
                }}
                onDragOver={isMe ? (e => e.preventDefault()) : undefined}
                onDrop={isMe ? (e => {
                    e.preventDefault();
                    e.stopPropagation();
                    const cardId = e.dataTransfer.getData('text/plain');
                    if (cardId && !cardId.startsWith('unequip:')) {
                        moves.equipByCardId(cardId);
                    }
                    this.setState({ draggingCardId: undefined });
                }) : undefined}
            >
                {card === undefined
                    ? <div className='equip-placeholder'>{EQUIP_SLOT_LABELS[slot]}</div>
                    : <div
                        className='equip-card'
                        draggable={draggable}
                        onDragStart={draggable ? (e => {
                            e.dataTransfer.setData('text/plain', `unequip:${slot}`);
                            e.dataTransfer.effectAllowed = 'move';
                            this.setState({ draggingEquipSlot: slot });
                        }) : undefined}
                        onDragEnd={draggable ? (() => this.setState({ draggingEquipSlot: undefined })) : undefined}
                        onClick={draggable ? (() => moves.unequip(slot)) : undefined}
                        title={draggable ? '点击或拖出：卸下装备' : EQUIP_CN[card.type] || card.type}
                    >
                        <img className='equip-card-img' src={`./cards/${card.type}.jpg`} alt={card.type} draggable={false} />
                        <div className='equip-card-name'>{EQUIP_CN[card.type] || card.type}</div>
                    </div>}
            </div>);
        });
    }

    // 手牌卡片可拖拽到装备栏；拖到棋盘空白处无效果（仅装备牌可入栏）
    handDragProps(card) {
        const slot = equipSlotOf(card.type);
        if (slot === undefined) {
            return undefined;
        }
        return {
            draggable: true,
            onDragStart: e => {
                e.dataTransfer.setData('text/plain', card.id);
                e.dataTransfer.effectAllowed = 'copy';
                this.setState({ draggingCardId: card.id });
            },
            onDragEnd: () => this.setState({ draggingCardId: undefined }),
        };
    }

    // 棋盘根区域：处理“拖出装备扔到桌上”（卸下装备）
    onBoardDragOver = e => {
        if (this.state.draggingEquipSlot !== undefined) {
            e.preventDefault();
        }
    };

    onBoardDrop = e => {
        const { moves } = this.props;
        if (this.state.draggingEquipSlot !== undefined) {
            e.preventDefault();
            moves.unequip(this.state.draggingEquipSlot);
            this.setState({ draggingEquipSlot: undefined });
        }
    };

    // 身份牌：只有本人与 GM 可见；主公展示后对所有人可见
    addRoleBadge(playerArea, player, isMe, nodes) {
        const { G, playerID, scaledWidth, scaledHeight } = this.props;
        const { roles, rolesDealt, kingRevealed } = G;
        if (!rolesDealt || !roles) {
            return;
        }
        const role = roles[player];
        if (!role || role === 'hidden') {
            return;
        }
        let show = false;
        if (playerID === '-1') {
            show = true;                                     // GM 全见
        } else if (isMe) {
            show = true;                                     // 自己
        } else if (kingRevealed && role === 'King') {
            show = true;                                     // 主公已展示
        }
        if (!show) {
            return;
        }
        nodes.push(<div
            key={`role-${player}`}
            className={classNames('positioned role-badge', role)}
            style={{
                left: playerArea.x + scaledWidth * 0.66,
                top: playerArea.y + INFO_DELTA,
                width: scaledWidth * 0.32,
                height: scaledHeight * 0.09,
                fontSize: scaledHeight * 0.05,
            }}
        >
            {ROLE_LABELS[role] || role}
        </div>);
    }

    // 卡牌指向：从出牌玩家到目标玩家的箭头，所有人（含 GM）可见
    renderTargetArrows() {
        const { G, ctx, playerID, playerAreas, width, height, scaledWidth, scaledHeight } = this.props;
        const { targets } = G;
        if (!targets || targets.length === 0) {
            return undefined;
        }
        const { numPlayers, playOrder } = ctx;
        const myPlayerIndex = Math.max(playOrder.indexOf(playerID), 0);
        const areaOf = pid => {
            const idx = (playOrder.indexOf(pid) - myPlayerIndex + numPlayers) % numPlayers;
            return playerAreas[idx];
        };
        const lines = targets.map(t => {
            const a = areaOf(t.source);
            const b = areaOf(t.target);
            if (!a || !b) {
                return undefined;
            }
            const x1 = a.x + scaledWidth / 2;
            const y1 = a.y + scaledHeight / 2;
            const x2 = b.x + scaledWidth / 2;
            const y2 = b.y + scaledHeight / 2;
            return <g key={t.id}>
                <line
                    x1={x1}
                    y1={y1}
                    x2={x2}
                    y2={y2}
                    stroke="#ff8c00"
                    strokeWidth={3}
                    strokeDasharray="6 4"
                />
                <circle cx={x2} cy={y2} r={7} fill="#ff8c00" />
                <text
                    x={(x1 + x2) / 2}
                    y={(y1 + y2) / 2 - 6}
                    fill="#ff8c00"
                    fontSize={14}
                    fontWeight="bold"
                    stroke="#000"
                    strokeWidth={0.5}
                    textAnchor="middle"
                >
                    {CARD_CN[t.cardType] || t.cardType}
                </text>
            </g>;
        }).filter(Boolean);
        if (lines.length === 0) {
            return undefined;
        }
        return <svg
            className="target-overlay"
            width={width}
            height={height}
        >
            {lines}
        </svg>;
    }

    addOtherPlayerHand(playerArea, player, normalCards, nodes, showFaces) {
        const { G, moves, scaledWidth, scaledHeight } = this.props;
        const { mode } = this.state;
        const { hands } = G;
        const hand = hands[player] || [];
        // 显示其他玩家的手牌（默认牌背；GM 视角显示牌面）
        hand.forEach(card => {
            let onClick = undefined;
            if (!showFaces && G.rolesDealt && (mode === SetModePanel.DISMANTLE_MODE || mode === SetModePanel.STEAL_MODE)) {
                onClick = () => {
                    const move = mode === SetModePanel.DISMANTLE_MODE ? moves.dismantle : moves.steal;
                    move({
                        playerID: player,
                        index: Math.floor(Math.random() * hand.length),
                    });
                    this.setState({ mode: SetModePanel.DEFAULT_MODE });
                };
            }
            normalCards.push({
                key: `card-${card.id}`,
                className: 'small-shadow',
                card,
                faceUp: showFaces,
                opacity: 1,
                left: playerArea.x + INFO_DELTA,
                top: playerArea.y + (1 - CARD_RATIO) * scaledHeight - INFO_DELTA,
                scale: CARD_RATIO,
                onClick,
            });
        });
        // 显示手牌数量
        if (hand.length > 0) {
            nodes.push(<div
                key={`card-count-${player}`}
                className='game-label'
                style={{
                    left: playerArea.x + INFO_DELTA,
                    top: playerArea.y + (1 - CARD_RATIO) * scaledHeight - INFO_DELTA,
                    width: scaledWidth * CARD_RATIO,
                    height: scaledHeight * CARD_RATIO,
                    marginLeft: scaledWidth * CARD_RATIO * 0.1,
                    marginTop: scaledWidth * CARD_RATIO * 0.1,
                    fontSize: scaledWidth * CARD_RATIO * 0.6,
                }}
            >
                {hand.length}
            </div>);
        }
    }

    addDeck(normalCards) {
        const { G, moves, height, scaledHeight } = this.props;
        const { mode } = this.state;
        const { deck, rolesDealt } = G;
        const MAX_CARDS_SHOWN = 10;
        deck.slice(-MAX_CARDS_SHOWN).forEach((card, i) => {
            let onClick = undefined;
            if (mode === SetModePanel.DEFAULT_MODE && rolesDealt && card === deck[deck.length - 1]) {
                onClick = () => moves.draw();
            }
            normalCards.push({
                key: `card-${card.id}`,
                card,
                opacity: 1,
                left: DELTA * (1 - i / MAX_CARDS_SHOWN),
                top: height - scaledHeight * DECK_RATIO - DELTA * (i / MAX_CARDS_SHOWN),
                scale: DECK_RATIO,
                onClick,
            });
        });
    }

    addMyHand(normalCards) {
        const { G, playerID, width, height, scaledWidth, scaledHeight } = this.props;
        const { hands } = G;
        const myHand = hands[playerID];
        if (myHand) {
            const spacing = Math.min(scaledWidth + DELTA, (width - (2 + DECK_RATIO) * scaledWidth - 5 * DELTA) / (myHand.length - 1));
            myHand.forEach((card, i) => {
                const onClick = this.selectFunction(i);
                const dragProps = this.handDragProps(card);
                normalCards.push({
                    key: `card-${card.id}`,
                    card,
                    faceUp: true,
                    opacity: onClick !== undefined ? 1 : 0.3,
                    left: DECK_RATIO * scaledWidth + 2 * DELTA + spacing * i,
                    top: height - scaledHeight - DELTA,
                    scale: 1,
                    onClick,
                    ...dragProps,
                });
            })
        }
    }

    addDiscard(normalCards) {
        const { G, moves, width, height, scaledWidth, scaledHeight } = this.props;
        const { mode } = this.state;
        const { discard, rolesDealt } = G;
        const MAX_DISCARDS_SHOWN = 4;
        const numCardsShown = Math.min(discard.length, MAX_DISCARDS_SHOWN);
        const startX = (width - numCardsShown * scaledWidth * MIDDLE_CARD_RATIO - (numCardsShown - 1) * DELTA) / 2;
        for (let i = 0; i < discard.length && i <= MAX_DISCARDS_SHOWN; i++) {
            const card = discard[discard.length - 1 - i];
            let onClick = undefined;
            if (mode === SetModePanel.DEFAULT_MODE && rolesDealt && i < MAX_DISCARDS_SHOWN) {
                onClick = () => moves.pickUp(discard.length - 1 - i);
            }
            normalCards.push({
                key: `card-${card.id}`,
                className: 'shadow',
                card,
                faceUp: true,
                opacity: i === MAX_DISCARDS_SHOWN ? 0 : 1,
                left: startX + (scaledWidth * MIDDLE_CARD_RATIO + DELTA) * i,
                top: (height - scaledHeight * MIDDLE_CARD_RATIO) / 2,
                scale: MIDDLE_CARD_RATIO,
                onClick,
            });
        }
    }

    renderSetModePanel() {
        const { G, ctx, moves, playerID } = this.props;
        if (playerID === '-1') {
            return undefined;
        }
        return <SetModePanel
            key='set-mode-panel'
            G={G}
            ctx={ctx}
            moves={moves}
            playerID={playerID}
            mode={this.state.mode}
            setMode={mode => this.setState({ mode })}
            selectFunction={this.selectFunction}
        />;
    }

    renderMyArea() {
        const { scaledHeight } = this.props;
        return <div
            key='my-area'
            className='my-area'
            style={{
                height: scaledHeight + 2 * DELTA,
            }}
        />;
    }

    renderActionButton() {
        const { G, ctx, playerID, width, height, scaledHeight, moves } = this.props;
        if (playerID === '-1') {
            return undefined;
        }
        const { currentPlayer } = ctx;
        const { ready, rolesDealt, kingRevealed } = G;
        const { mode, selectedIndex } = this.state;
        const ACTION_BUTTON_WIDTH = 200;
        const ACTION_BUTTON_HEIGHT = 30;
        let actionButton = undefined;
        if (!rolesDealt) {
            // 发身份牌之前：玩家就位
            const readyMap = ready || {};
            if (readyMap[playerID] === true) {
                actionButton = {
                    text: '已就位（点击取消）',
                    type: 'selectable',
                    onClick: () => moves.ready(),
                };
            } else {
                actionButton = {
                    text: '就位',
                    type: 'selectable warn',
                    onClick: () => moves.ready(),
                };
            }
        } else if (mode === SetModePanel.TARGET_MODE && selectedIndex !== undefined) {
            actionButton = {
                text: '选择目标：点击一名玩家（Esc 取消）',
                type: 'disabled',
            };
        } else if (rolesDealt && !kingRevealed && currentPlayer === playerID) {
            actionButton = {
                text: '将回合交给主公并展示主公身份',
                type: 'selectable warn',
                onClick: () => moves.revealKingAndHandTurn(),
            };
        } else if (this.stage() === 'play' && currentPlayer === playerID) {
            actionButton = {
                text: '结束出牌',
                type: 'selectable warn',
                onClick: () => moves.endPlay(),
            }
        } else if (this.stage() === 'discard') {
            actionButton = {
                text: '弃牌（需弃至不超过体力值）',
                type: 'disabled',
            };
        }
        if (actionButton !== undefined) {
            const { text, type, onClick } = actionButton;
            return <button
                className={`positioned ${type}`}
                style={{
                    left: (width - ACTION_BUTTON_WIDTH) / 2,
                    top: height - scaledHeight - ACTION_BUTTON_HEIGHT - 3 * DELTA,
                    width: ACTION_BUTTON_WIDTH,
                    height: ACTION_BUTTON_HEIGHT,
                }}
                onClick={onClick}
                disabled={onClick === undefined}
            >
                {text}
            </button>;
        }
    }

    renderUploadInput() {
        return <input
            ref={el => this.fileInput = el}
            type="file"
            accept="image/*"
            style={{ display: 'none' }}
            onChange={this.handleFile}
        />;
    }

    handleFile = e => {
        const file = e.target.files && e.target.files[0];
        const { uploadTarget } = this.state;
        e.target.value = '';
        if (!file || uploadTarget === undefined) {
            return;
        }
        const reader = new FileReader();
        reader.onload = ev => {
            const image = new Image();
            image.onload = async () => {
                const scale = Math.min(1, IMAGE_MAX_SIZE / Math.max(image.width, image.height));
                const canvas = document.createElement('canvas');
                canvas.width = Math.max(1, Math.round(image.width * scale));
                canvas.height = Math.max(1, Math.round(image.height * scale));
                canvas.getContext('2d').drawImage(image, 0, 0, canvas.width, canvas.height);
                canvas.toBlob(async blob => {
                    try {
                        // 上传到服务器文件，状态里只存 URL（避免 base64 大图随每次广播重发）
                        const form = new FormData();
                        form.append('image', blob, 'avatar.jpg');
                        form.append('matchID', this.props.matchID || '');
                        form.append('playerID', this.props.playerID || '');
                        const res = await fetch('/api/upload', { method: 'POST', body: form });
                        const data = await res.json();
                        if (res.ok && data.url) {
                            this.props.moves.setImage(data.url);
                        }
                    } catch (err) {
                        // 上传失败：不阻塞
                    }
                    this.setState({ uploadTarget: undefined });
                }, 'image/jpeg', 0.85);
            };
            image.src = ev.target.result;
        };
        reader.readAsDataURL(file);
    }

    selectFunction = index => {
        const { G, moves, playerID } = this.props;
        const { mode } = this.state;
        const { hands, rolesDealt } = G;
        const card = hands[playerID][index];
        if (card === undefined) {
            return undefined;
        }
        if (!rolesDealt) {
            // 身份牌发放前只能就位，不能操作手牌
            return undefined;
        }
        if (mode === SetModePanel.DEFAULT_MODE && this.stage() === 'play') {
            if (TARGETED_CARDS.includes(card.type)) {
                // 需要目标的卡牌：先选择目标
                return () => this.setState({ mode: SetModePanel.TARGET_MODE, selectedIndex: index });
            }
            return () => moves.play(index);
        } else if (mode === SetModePanel.DEFAULT_MODE && this.stage() === 'discard') {
            return () => moves.discardCard(index);
        }
        // 拆牌/偷牌只针对其他玩家的手牌，自己的牌在 DEFAULT 模式下直接打出
        return undefined;
    }

    stage() {
        const { ctx, playerID } = this.props;
        const { activePlayers } = ctx;
        return activePlayers && activePlayers[playerID];
    }
}
