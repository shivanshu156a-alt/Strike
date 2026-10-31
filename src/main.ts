import { Game } from './game';
import { EMPTY_ARENA } from './maps';
import './style.css';

const app = document.querySelector<HTMLDivElement>('#app');
if (!app) throw new Error('The game root element could not be found.');

app.innerHTML = `
  <main class="app-shell">
    <section class="main-menu" aria-label="Elemental Dash main menu">
      <div class="menu-art" aria-hidden="true"></div>
      <div class="menu-controls">
        <button class="menu-hit-area menu-play" type="button" aria-label="Play"></button>
        <button class="menu-hit-area menu-settings" type="button" aria-label="Settings"></button>
        <button class="menu-hit-area menu-how-to-play" type="button" aria-label="How to Play"></button>
        <button class="menu-hit-area menu-quit" type="button" aria-label="Quit"></button>
      </div>
      <label class="mob-test-toggle" for="disable-mobs">
        <input id="disable-mobs" type="checkbox">
        <span>Disable mobs (test)</span>
      </label>
    </section>
    <section id="game-view" aria-label="Game view" hidden>
      <div class="game-loading" role="status" aria-live="polite">
        <div class="game-loading-card">
          <h1 class="game-loading-title">Preparing the arena</h1>
          <p class="game-loading-message">Loading characters and animations…</p>
          <div
            class="game-loading-track"
            role="progressbar"
            aria-label="Game loading progress"
            aria-valuemin="0"
            aria-valuemax="100"
            aria-valuenow="0"
          >
            <div class="game-loading-fill"></div>
          </div>
          <p class="game-loading-percent">0%</p>
          <div class="game-loading-error" role="alert" hidden>
            <p>Game assets could not be loaded. Check your connection and try again.</p>
            <button class="loading-retry-button" type="button">Retry</button>
            <button class="loading-menu-button" type="button">Back to menu</button>
          </div>
        </div>
      </div>
    </section>
    <dialog class="menu-dialog" id="settings-dialog" aria-labelledby="settings-title">
      <form method="dialog">
        <h1 id="settings-title">Settings</h1>
        <label class="sensitivity-setting" for="sensitivity">
          <span>Mouse sensitivity</span>
          <output id="sensitivity-value" for="sensitivity">1.0×</output>
          <input id="sensitivity" type="range" min="0.4" max="2" step="0.1" value="1">
        </label>
        <p class="dialog-note">Controls are shown in How to Play.</p>
        <button class="dialog-button" type="submit">Done</button>
      </form>
    </dialog>
    <dialog class="menu-dialog" id="how-to-play-dialog" aria-labelledby="how-to-play-title">
      <form method="dialog">
        <h1 id="how-to-play-title">How to Play</h1>
        <ul class="controls-list">
          <li><kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd> Move</li>
          <li><kbd>Shift</kbd> Sprint <span aria-hidden="true">·</span> <kbd>Ctrl</kbd> Crouch</li>
          <li><kbd>Space</kbd> Jump</li>
          <li>Starts in floating camera; press <kbd>L</kbd> to toggle First Person / Floating Camera</li>
          <li>Click the game to start (you are safe until then); drag on touchscreens to look around</li>
          <li><kbd>1</kbd> Fists <span aria-hidden="true">·</span> <kbd>2</kbd> Melee <span aria-hidden="true">·</span> <kbd>3</kbd> Shooter (10 damage each)</li>
          <li>Scroll the mouse wheel to change attacks; left click to attack</li>
          <li>On mobile, use the on-screen buttons for movement, combat, abilities, elements and menu</li>
          <li><kbd>Esc</kbd> Return to menu (including after death)</li>
        </ul>
        <p class="dialog-note">Hostile mobs are active. Player defence is not implemented yet.</p>
        <button class="dialog-button" type="submit">Back</button>
      </form>
    </dialog>
    <dialog class="menu-dialog" id="quit-dialog" aria-labelledby="quit-title">
      <form method="dialog">
        <h1 id="quit-title">Quit</h1>
        <p class="dialog-note">You can close this browser tab to leave the game.</p>
        <button class="dialog-button" type="submit">Back to menu</button>
      </form>
    </dialog>
  </main>
`;

const menu = app.querySelector<HTMLElement>('.main-menu');
const gameView = app.querySelector<HTMLElement>('#game-view');
const loadingScreen = gameView?.querySelector<HTMLElement>('.game-loading');
const loadingMessage = gameView?.querySelector<HTMLElement>('.game-loading-message');
const loadingProgress = gameView?.querySelector<HTMLElement>('.game-loading-track');
const loadingFill = gameView?.querySelector<HTMLElement>('.game-loading-fill');
const loadingPercent = gameView?.querySelector<HTMLElement>('.game-loading-percent');
const loadingError = gameView?.querySelector<HTMLElement>('.game-loading-error');
const retryButton = gameView?.querySelector<HTMLButtonElement>('.loading-retry-button');
const loadingMenuButton = gameView?.querySelector<HTMLButtonElement>('.loading-menu-button');
const playButton = app.querySelector<HTMLButtonElement>('.menu-play');
const settingsButton = app.querySelector<HTMLButtonElement>('.menu-settings');
const howToPlayButton = app.querySelector<HTMLButtonElement>('.menu-how-to-play');
const quitButton = app.querySelector<HTMLButtonElement>('.menu-quit');
const settingsDialog = app.querySelector<HTMLDialogElement>('#settings-dialog');
const howToPlayDialog = app.querySelector<HTMLDialogElement>('#how-to-play-dialog');
const quitDialog = app.querySelector<HTMLDialogElement>('#quit-dialog');
const sensitivityInput = app.querySelector<HTMLInputElement>('#sensitivity');
const sensitivityValue = app.querySelector<HTMLOutputElement>('#sensitivity-value');
const disableMobsInput = app.querySelector<HTMLInputElement>('#disable-mobs');

if (
  !menu || !gameView || !loadingScreen || !loadingMessage || !loadingProgress || !loadingFill
  || !loadingPercent || !loadingError || !retryButton || !loadingMenuButton
  || !playButton || !settingsButton || !howToPlayButton || !quitButton
  || !settingsDialog || !howToPlayDialog || !quitDialog || !sensitivityInput || !sensitivityValue
  || !disableMobsInput
) {
  throw new Error('The main menu could not be initialized.');
}

let game: Game | undefined;
let mouseSensitivity = Number(sensitivityInput.value);

const exitGame = (): void => {
  game?.destroy();
  game = undefined;
  gameView.hidden = true;
  menu.hidden = false;
};

const startGame = (): void => {
  game?.destroy();
  game = undefined;
  loadingError.hidden = true;
  loadingMessage.textContent = 'Loading characters and animations…';
  loadingProgress.setAttribute('aria-valuenow', '0');
  loadingFill.style.width = '0%';
  loadingPercent.textContent = '0%';
  loadingScreen.hidden = false;
  menu.hidden = true;
  gameView.hidden = false;

  try {
    const newGame = new Game(
      gameView,
      EMPTY_ARENA,
      mouseSensitivity,
      !disableMobsInput.checked,
      (progress) => {
        const percent = Math.round(progress * 100);
        loadingProgress.setAttribute('aria-valuenow', String(percent));
        loadingFill.style.width = `${percent}%`;
        loadingPercent.textContent = `${percent}%`;
      },
    );
    game = newGame;
    void newGame.ready.then(() => {
      if (game === newGame) loadingScreen.hidden = true;
    }).catch((error: unknown) => {
      if (game !== newGame) return;
      console.error('Unable to prepare the game assets.', error);
      loadingMessage.textContent = 'The game could not be prepared.';
      loadingError.hidden = false;
      retryButton.focus();
    });
  } catch (error) {
    console.error('Unable to initialize the game.', error);
    loadingMessage.textContent = 'The game could not be prepared.';
    loadingError.hidden = false;
    retryButton.focus();
  }
};

playButton.addEventListener('click', startGame);
retryButton.addEventListener('click', startGame);
loadingMenuButton.addEventListener('click', exitGame);

settingsButton.addEventListener('click', () => settingsDialog.showModal());
howToPlayButton.addEventListener('click', () => howToPlayDialog.showModal());
quitButton.addEventListener('click', () => quitDialog.showModal());

sensitivityInput.addEventListener('input', () => {
  mouseSensitivity = Number(sensitivityInput.value);
  sensitivityValue.value = `${mouseSensitivity.toFixed(1)}×`;
});

gameView.addEventListener('gameexit', exitGame);

document.addEventListener('keydown', (event: KeyboardEvent) => {
  if (event.key !== 'Escape' || !game) return;
  exitGame();
});
