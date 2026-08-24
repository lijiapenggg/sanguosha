import React from 'react';
import { LobbyClient } from 'boardgame.io/client';
import { SocketIO } from 'boardgame.io/multiplayer';
import { Client } from 'boardgame.io/react';
import { SanGuoSha } from '../lib/game';
import { SanGuoShaBoard } from './board';
import './lobby.css';

const SERVER = process.env.REACT_APP_PROXY || document.location.toString().replace(/\/$/, '');
const NAME_KEY = 'name';
const MATCH_INFO_KEY = 'matchInfo';
const INPUT_NAME_ID = 'name-input';
const NUM_PLAYERS = 5;
const GM_PLAYER_ID = '-1';

const SanGuoShaClient = Client({
    game: SanGuoSha,
    board: SanGuoShaBoard,
    multiplayer: SocketIO({ server: SERVER }),
    debug: false,
});

export default class SanGuoShaLobby extends React.Component {

    constructor(props) {
        super(props);
        this.lobbyClient = new LobbyClient({ server: SERVER });
        const matchInfoRaw = window.localStorage.getItem(MATCH_INFO_KEY);
        this.state = {
            name: window.localStorage.getItem(NAME_KEY),
            matchInfo: matchInfoRaw ? JSON.parse(matchInfoRaw) : undefined, // { matchID, playerID, credentials }
            match: undefined, // the singleton room
            inGame: false,
        };
    }

    componentDidMount() {
        // Mobile requires explicit user action to play audio
        const lobbyView = document.querySelector('#lobby-view');
        if (lobbyView) {
            lobbyView.addEventListener('click', this.props.playAudio);
        }
        this.refreshLobbyState();
    }

    componentWillUnmount() {
        const lobbyView = document.querySelector('#lobby-view');
        if (lobbyView) {
            lobbyView.removeEventListener('click', this.props.playAudio);
        }
        clearTimeout(this.timeout);
    }

    refreshLobbyState = async () => {
        const { matchInfo } = this.state;

        // 已在一个对局中：确认房间还在，然后直接进入游戏
        if (matchInfo !== undefined) {
            try {
                const { matches } = await this.lobbyClient.listMatches(SanGuoSha.name);
                const match = matches.find(m => m.matchID === matchInfo.matchID && !m.gameover);
                if (match !== undefined) {
                    this.setState({ match, inGame: true });
                    return;
                }
                // 房间已不存在，清除本地记录
                window.localStorage.removeItem(MATCH_INFO_KEY);
                this.setState({ matchInfo: undefined });
            } catch (e) {
                // 服务器暂不可达，继续轮询
            }
        }

        try {
            const { matches } = await this.lobbyClient.listMatches(SanGuoSha.name);
            // 找到（或创建）唯一的房间
            let match = matches.find(m => m.setupData && m.setupData.singleton && !m.gameover);
            if (match === undefined) {
                const { matchID } = await this.lobbyClient.createMatch(SanGuoSha.name, {
                    numPlayers: NUM_PLAYERS,
                    setupData: { singleton: true },
                });
                match = { matchID, players: [] };
            }
            this.setState({ match });
        } catch (e) {
            // 服务器未就绪，稍后重试
        }

        clearTimeout(this.timeout);
        this.timeout = setTimeout(this.refreshLobbyState, 1000);
    }

    render() {
        const { matchInfo, inGame } = this.state;
        if (inGame) {
            const { matchID, playerID, credentials } = matchInfo;
            const isGM = playerID === GM_PLAYER_ID;
            return <div>
                <SanGuoShaClient
                    matchID={matchID}
                    playerID={playerID}
                    credentials={credentials}
                />
                {isGM && <div className='gm-banner'>{'GM 模式：旁观中，可查看所有玩家手牌'}</div>}
                <button
                    className="leave-button"
                    onClick={() => this.leaveMatch().then(this.refreshLobbyState)}
                >
                    {'离开房间'}
                </button>
            </div>;
        }
        return <div className='lobby'>
            <div className='title'>
                <h1>{'跑团卡牌桌'}</h1>
            </div>
            <div id="lobby-view">{this.renderLobby()}</div>
        </div>;
    }

    resetName = () => {
        window.localStorage.removeItem(NAME_KEY);
        this.setState({ name: null });
    }

    renderLobby() {
        const { name, match } = this.state;
        if (name === null || name === undefined) {
            return <div>
                <p>{'输入玩家名字：'}</p>
                <input
                    id={INPUT_NAME_ID}
                    type="text"
                    defaultValue="玩家"
                    onKeyPress={e => {
                        if (e.nativeEvent.key === 'Enter') {
                            this.setName();
                        }
                    }}
                />
                <button onClick={this.setName}>{'进入'}</button>
            </div>;
        }
        if (match === undefined) {
            return <div>
                <p>{`欢迎，${name}`}</p>
                <button onClick={this.resetName}>{'修改名字'}</button>
                <p>{'正在连接房间...'}</p>
            </div>;
        }
        return <div>
            <p>{`欢迎，${name}`}</p>
            <button onClick={this.resetName}>{'修改名字'}</button>
            <h3>{'房间（5 名玩家，1 名 GM）'}</h3>
            {this.renderSeats()}
            <p>
                <button onClick={this.joinAsGM}>{'以 GM 身份进入（可查看所有玩家手牌）'}</button>
            </p>
        </div>;
    }

    renderSeats() {
        const { matchInfo, match } = this.state;
        const players = match.players || [];
        const rows = [];
        for (let i = 0; i < NUM_PLAYERS; i++) {
            const player = players[i];
            const occupied = player !== undefined && player.name !== undefined;
            const isMe = matchInfo !== undefined && matchInfo.matchID === match.matchID && matchInfo.playerID === i.toString();
            let button;
            if (isMe) {
                button = <button onClick={() => this.setState({ inGame: true })}>{'返回游戏'}</button>;
            } else if (occupied) {
                button = <button disabled={true}>{'已满'}</button>;
            } else {
                button = <button onClick={() => this.joinSeat(i)}>{'加入'}</button>;
            }
            rows.push(
                <tr key={i}>
                    <td>{`座位 ${i + 1}`}</td>
                    <td>{occupied ? player.name : '空位'}</td>
                    <td>{button}</td>
                </tr>
            );
        }
        return <div id="instances">
            <table>
                <tbody>
                    <tr>
                        <th>{'座位'}</th>
                        <th>{'玩家'}</th>
                        <th></th>
                    </tr>
                    {rows}
                </tbody>
            </table>
        </div>;
    }

    joinSeat = async (playerID) => {
        const { match } = this.state;
        await this.joinMatch(match.matchID, playerID.toString());
        this.setState({ inGame: true });
        this.refreshLobbyState();
    }

    joinAsGM = () => {
        const { match } = this.state;
        this.setState({
            matchInfo: { matchID: match.matchID, playerID: GM_PLAYER_ID },
            inGame: true,
        });
    }

    setName = () => {
        const name = document.getElementById(INPUT_NAME_ID).value;
        this.setState({ name });
        window.localStorage.setItem(NAME_KEY, name);
    }

    joinMatch = async (matchID, playerID) => {
        const { name } = this.state;
        const { playerCredentials } = await this.lobbyClient.joinMatch(
            SanGuoSha.name,
            matchID,
            {
                playerID,
                playerName: name,
            },
        );
        const matchInfo = {
            matchID,
            playerID,
            credentials: playerCredentials,
        };
        window.localStorage.setItem(MATCH_INFO_KEY, JSON.stringify(matchInfo));
        this.setState({ matchInfo });
    }

    leaveMatch = async () => {
        const { matchInfo } = this.state;
        this.setState({ matchInfo: undefined, inGame: false });
        window.localStorage.removeItem(MATCH_INFO_KEY);
        if (matchInfo === undefined || matchInfo.credentials === undefined) {
            return;
        }
        const { matchID, playerID, credentials } = matchInfo;
        await this.lobbyClient.leaveMatch(
            SanGuoSha.name,
            matchID,
            {
                playerID,
                credentials,
            },
        );
    }
}
