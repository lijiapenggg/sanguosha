import React from 'react';
import './setModePanel.css';

export default class SetModePanel extends React.Component {

    static DEFAULT_MODE = 'default';
    static DISMANTLE_MODE = 'dismantle';
    static STEAL_MODE = 'steal';

    componentDidMount() {
        document.addEventListener('keydown', this.handleHotkey);
    }

    componentWillUnmount() {
        document.removeEventListener('keydown', this.handleHotkey);
    }

    render() {
        const { moves } = this.props;
        return <div className='set-mode-panel'>
            <div className='section'>
                {this.renderModeButton(SetModePanel.DEFAULT_MODE, '默认')}
                {this.renderModeButton(SetModePanel.DISMANTLE_MODE, '过河拆桥')}
                {this.renderModeButton(SetModePanel.STEAL_MODE, '顺手牵羊')}
            </div>
            <div className='section'>
                <button
                    className='clickable'
                    onClick={() => moves.draw()}
                >
                    {'摸一张牌 (C)'}
                </button>
                {this.renderEndButton()}
                {this.renderNoDiscardButton()}
            </div>
            <div className='section hint'>
                {'Esc 取消 · 1-9 打出手牌 · 点击牌堆摸牌'}
            </div>
        </div>;
    }

    renderModeButton(targetMode, label) {
        const { mode, setMode } = this.props;
        return <button
            className={mode === targetMode ? 'toggled' : 'selectable'}
            disabled={mode === targetMode}
            onClick={() => setMode(targetMode)}
        >
            {label}
        </button>
    }

    renderEndButton() {
        const { moves, ctx, playerID } = this.props;
        if (this.stage() === 'play' && ctx.currentPlayer === playerID) {
            return <button
                className='clickable'
                onClick={() => moves.endPlay()}
            >
                {'结束出牌 (E)'}
            </button>;
        }
    }

    renderNoDiscardButton() {
        const { moves } = this.props;
        if (this.stage() === 'discard') {
            return <button
                className='clickable'
                onClick={() => moves.finishDiscard()}
            >
                {'跳过弃牌 (N)'}
            </button>
        }
    }

    handleHotkey = e => {
        const { setMode, selectFunction, moves } = this.props;
        if (e.altKey || e.ctrlKey || e.metaKey) {
            return;
        }
        switch (e.key) {
            case "Escape":
                setMode(SetModePanel.DEFAULT_MODE);
                break;
            case "d":
            case "D":
                setMode(SetModePanel.DISMANTLE_MODE);
                break;
            case "s":
            case "S":
                setMode(SetModePanel.STEAL_MODE);
                break;
            case "c":
            case "C":
                moves.draw();
                break;
            case "e":
            case "E":
                moves.endPlay();
                break;
            case "n":
            case "N":
                moves.finishDiscard();
                break;
            default:
                break;
        }
        if (e.keyCode >= 49 && e.keyCode <= 57) {
            const func = selectFunction(e.keyCode - 49);
            if (func) {
                func();
            }
        }
    };

    stage() {
        const { ctx, playerID } = this.props;
        const { activePlayers } = ctx;
        return activePlayers && activePlayers[playerID];
    }
}
