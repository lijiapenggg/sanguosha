import * as classNames from 'classnames';
import React from 'react';
import SetModePanel from './setModePanel';
import AnimatedBoard from './animatedBoard';
import './gameArea.css';

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
        };
    }

    componentDidUpdate() {
        const { G, ctx, events, moves } = this.props;
        window.sanguosha = { G, ctx, events, moves };
    }

    render() {
        const { ctx, playerID, width, height, playerAreas, scaledWidth, scaledHeight } = this.props;
        const { numPlayers, playOrder } = ctx;
        const isGM = playerID === '-1';

        const characterCards = [];
        const normalCards = [];
        const nodes = [];

        const myPlayerIndex = Math.max(playOrder.indexOf(playerID), 0);
        playerAreas.forEach((playerArea, i) => {
            const playerIndex = (myPlayerIndex + i) % numPlayers;
            const player = playOrder[playerIndex];
            const isMe = player === playerID;

            this.addPlayerName(playerArea, playerIndex, player, nodes, isGM);
            this.addPlayerImage(playerArea, player, isMe, characterCards);
            this.addHealth(playerArea, player, isMe, nodes);
            if (isGM || !isMe) {
                this.addOtherPlayerHand(playerArea, player, normalCards, nodes, isGM);
            }
        });

        this.addDeck(normalCards);
        this.addMyHand(normalCards);
        this.addDiscard(normalCards);

        return <div>
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
            {this.renderActionButton()}
            {this.renderSetModePanel()}
            {this.renderUploadInput()}
        </div>;
    }

    addPlayerName(playerArea, playerIndex, player, nodes, showAll) {
        const { ctx, playerID, matchData, scaledWidth, scaledHeight } = this.props;
        const { currentPlayer } = ctx;
        if (matchData !== undefined && (showAll || player !== playerID)) {
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
        const { G, scaledWidth, scaledHeight } = this.props;
        const { playerImages } = G;
        const { mode } = this.state;
        const image = playerImages[player];

        let onClick = undefined;
        let placeholderText = undefined;
        if (image === undefined) {
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

        nodes.push(<div
            key={`hp-${player}`}
            className='positioned hp-label'
            style={{
                left: playerArea.x + INFO_DELTA,
                top: playerArea.y + INFO_DELTA,
                width: labelWidth,
                height: labelHeight,
                fontSize: scaledHeight * 0.05,
            }}
        >
            {`HP ${health.current}/${health.max}`}
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
            nodes.push(<button
                key='hp-max-minus'
                className='positioned hp-btn'
                style={{
                    left: playerArea.x + INFO_DELTA + 2 * (btnWidth + INFO_DELTA),
                    top: rowTop,
                    width: btnWidth * 1.3,
                    height: btnHeight,
                    fontSize: scaledHeight * 0.04,
                }}
                onClick={() => moves.updateMaxHealth(-1)}
            >
                {'上限-'}
            </button>);
            nodes.push(<button
                key='hp-max-plus'
                className='positioned hp-btn'
                style={{
                    left: playerArea.x + INFO_DELTA + 2 * (btnWidth + INFO_DELTA) + btnWidth * 1.3 + INFO_DELTA,
                    top: rowTop,
                    width: btnWidth * 1.3,
                    height: btnHeight,
                    fontSize: scaledHeight * 0.04,
                }}
                onClick={() => moves.updateMaxHealth(1)}
            >
                {'上限+'}
            </button>);
        }
    }

    addOtherPlayerHand(playerArea, player, normalCards, nodes, showFaces) {
        const { G, moves, scaledWidth, scaledHeight } = this.props;
        const { mode } = this.state;
        const { hands } = G;
        const hand = hands[player] || [];
        // 显示其他玩家的手牌（默认牌背；GM 视角显示牌面）
        hand.forEach(card => {
            let onClick = undefined;
            if (!showFaces && (mode === SetModePanel.DISMANTLE_MODE || mode === SetModePanel.STEAL_MODE)) {
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
        const { deck } = G;
        const MAX_CARDS_SHOWN = 10;
        deck.slice(-MAX_CARDS_SHOWN).forEach((card, i) => {
            let onClick = undefined;
            if (mode === SetModePanel.DEFAULT_MODE && card === deck[deck.length - 1]) {
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
                normalCards.push({
                    key: `card-${card.id}`,
                    card,
                    faceUp: true,
                    opacity: onClick !== undefined ? 1 : 0.3,
                    left: DECK_RATIO * scaledWidth + 2 * DELTA + spacing * i,
                    top: height - scaledHeight - DELTA,
                    scale: 1,
                    onClick,
                });
            })
        }
    }

    addDiscard(normalCards) {
        const { G, moves, width, height, scaledWidth, scaledHeight } = this.props;
        const { mode } = this.state;
        const { discard } = G;
        const MAX_DISCARDS_SHOWN = 4;
        const numCardsShown = Math.min(discard.length, MAX_DISCARDS_SHOWN);
        const startX = (width - numCardsShown * scaledWidth * MIDDLE_CARD_RATIO - (numCardsShown - 1) * DELTA) / 2;
        for (let i = 0; i < discard.length && i <= MAX_DISCARDS_SHOWN; i++) {
            const card = discard[discard.length - 1 - i];
            let onClick = undefined;
            if (mode === SetModePanel.DEFAULT_MODE && i < MAX_DISCARDS_SHOWN) {
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
        const { ctx, playerID, width, height, scaledHeight, moves } = this.props;
        if (playerID === '-1') {
            return undefined;
        }
        const { currentPlayer } = ctx;
        const ACTION_BUTTON_WIDTH = 160;
        const ACTION_BUTTON_HEIGHT = 30;
        let actionButton = undefined;
        if (this.stage() === 'play' && currentPlayer === playerID) {
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
            image.onload = () => {
                const scale = Math.min(1, IMAGE_MAX_SIZE / Math.max(image.width, image.height));
                const canvas = document.createElement('canvas');
                canvas.width = Math.max(1, Math.round(image.width * scale));
                canvas.height = Math.max(1, Math.round(image.height * scale));
                canvas.getContext('2d').drawImage(image, 0, 0, canvas.width, canvas.height);
                const dataUrl = canvas.toDataURL('image/jpeg', 0.85);
                this.props.moves.setImage(dataUrl);
                this.setState({ uploadTarget: undefined });
            };
            image.src = ev.target.result;
        };
        reader.readAsDataURL(file);
    }

    selectFunction = index => {
        const { G, moves, playerID } = this.props;
        const { mode } = this.state;
        const { hands } = G;
        const card = hands[playerID][index];
        if (card === undefined) {
            return undefined;
        }
        if (mode === SetModePanel.DEFAULT_MODE && this.stage() === 'play') {
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
