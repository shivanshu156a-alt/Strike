import { Game } from './game';
import { EMPTY_ARENA } from './maps';
import './style.css';

const app = document.querySelector<HTMLDivElement>('#app');
if (!app) throw new Error('The game root element could not be found.');

app.innerHTML = '<div id="game-view" aria-label="Free camera view"></div>';

const gameView = document.querySelector<HTMLElement>('#game-view');
if (!gameView) throw new Error('The game view could not be created.');

new Game(gameView, EMPTY_ARENA);
