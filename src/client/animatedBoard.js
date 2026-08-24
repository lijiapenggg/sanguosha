import * as classNames from 'classnames';
import React from 'react';
import { animated, interpolate } from 'react-spring';
import AnimatedItems from './animatedItems';
import './animatedBoard.css';

const SUITS = {
    'CLUB': '♣',
    'DIAMOND': '♢',
    'HEART': '♡',
    'SPADE': '♠',
};

export default class AnimatedBoard extends React.Component {

    render() {
        const { scaledWidth, scaledHeight, characterCards, normalCards } = this.props;
        return <div>
            <AnimatedItems
                items={characterCards}
                from={_ => { return { opacity: 0 }; }}
                update={item => {
                    return {
                        opacity: item.opacity,
                        left: item.left,
                        top: item.top,
                    };
                }}
                clickable={true}
                animated={(item, props) => {
                    const { opacity, left, top } = props;
                    if (item.placeholderText !== undefined) {
                        return <animated.div
                            className='positioned item image-placeholder'
                            style={{
                                opacity,
                                left,
                                top,
                                width: item.width,
                                height: item.height,
                            }}
                        >
                            {item.placeholderText}
                        </animated.div>;
                    }
                    return <animated.img
                        className='positioned item shadow'
                        src={item.src}
                        alt='player image'
                        style={{
                            opacity,
                            left,
                            top,
                            width: item.width,
                            height: item.height,
                        }} />;
                }}
            />
            <AnimatedItems
                items={normalCards}
                from={_ => { return { opacity: 0 } }}
                update={item => {
                    return {
                        faceUp: item.faceUp ? 1 : 0,
                        sideways: item.sideways ? 1 : 0,
                        opacity: item.opacity,
                        left: item.left,
                        top: item.top,
                        scale: item.scale,
                    };
                }}
                clickable={true}
                animated={(item, props) => {
                    const { faceUp, sideways, opacity, left, top, scale } = props;
                    return <animated.div
                        className='positioned'
                        style={{
                            transformOrigin: '0 0',
                            transform: interpolate([sideways, scale], (sideways, scale) => `scale(${scale}) rotateZ(${sideways * 90}deg)`),
                            opacity,
                            left,
                            top,
                            width: scaledWidth,
                            height: scaledHeight,
                        }}
                    >
                        <animated.div
                            className={classNames('positioned', 'item', item.className)}
                            style={{
                                transform: faceUp.interpolate(faceUp => `rotateY(${faceUp * 180 - (faceUp > 0.5 ? 180 : 0)}deg)`),
                                left: 0,
                                top: 0,
                                width: '100%',
                                height: '100%',
                            }}
                        >
                            <animated.img
                                className='fill'
                                src={faceUp.interpolate(faceUp => faceUp > 0.5 ? `./cards/${item.card.type}.jpg` : './cards/Card Back.jpg')}
                                alt={'card'}
                            />
                            <animated.div
                                className={classNames('card-value', ['DIAMOND', 'HEART'].includes(item.card.suit) ? 'red' : 'black')}
                                style={{
                                    opacity: faceUp,
                                }}
                            >
                                {item.card.value}
                                <br />
                                {SUITS[item.card.suit]}
                            </animated.div>
                        </animated.div>
                    </animated.div>
                }}
            />
        </div>
    }
}
