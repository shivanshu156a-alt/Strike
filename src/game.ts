import * as THREE from 'three';
import { ARENA_GRID_SIZE, GRID_UNIT_SIZE, buildMap, type ArenaMap } from './maps';
import { HOSTILE_MOBS } from './hostileMobs';
import { HostileMob, type HostileMobHealth } from './hostileMob';
import {
  Player,
  PLAYER_ATTACKS,
  type PlayerAttackId,
  type PlayerHealthChange,
  type WeaponCombatProfile,
} from './player';



const ARENA_HALF_EXTENT = ARENA_GRID_SIZE * GRID_UNIT_SIZE / 2;
const CROUCHING_HEIGHT = 1.05;
const WALK_SPEED = 8;
const SPRINT_SPEED = 14;
const CROUCH_SPEED = 4;
const JUMP_SPEED = 7;
const GRAVITY = 20;
const MINIMUM_HOSTILE_SPAWN_DISTANCE = 7;
const DEATH_CINEMATIC_DURATION = 5;
const DEATH_SLOW_MOTION_SCALE = 0.2;
const PLAYER_KNOCKBACK_FORCE = 5;
const CAMERA_HIT_TILT = 0.24;

interface PlayerProjectile {
  mesh: THREE.Mesh;
  direction: THREE.Vector3;
  remainingRange: number;
  speed: number;
  damage: number;
}

export type GameAction =
  | 'reload'
  | 'defend'
  | 'equip'
  | 'special'
  | 'attack'
  | 'focus'
  | 'weapon-swap'
  | 'element-select';

export interface GameActionDetail {
  action: GameAction;
  value?: number | boolean;
  weapon?: WeaponCombatProfile;
}

export type CameraView = 'first-person' | 'floating';

export class Game {
  readonly renderer: THREE.WebGLRenderer;
  readonly camera: THREE.PerspectiveCamera;
  readonly player = new Player();

  private readonly scene = new THREE.Scene();
  private readonly clock = new THREE.Clock();
  private readonly raycaster = new THREE.Raycaster();
  private readonly canvas: HTMLCanvasElement;
  private readonly playerMesh: THREE.Mesh;
  private readonly playerProjectiles: PlayerProjectile[] = [];
  private readonly hud: HTMLElement;
  private readonly touchControls: HTMLElement;
  private readonly attackStatus: HTMLElement;
  private readonly spawnProtectionMessage: HTMLElement;
  private readonly deathScreen: HTMLElement;
  private readonly playerHealthElements: {
    label: HTMLElement;
    track: HTMLElement;
    fill: HTMLElement;
  };
  private readonly mobHealthRows = new Map<string, {
    card: HTMLElement;
    fill: HTMLElement;
    label: HTMLElement;
  }>();
  private readonly hostileMobs: HostileMob[] = [];
  private readonly keys = new Set<string>();
  private readonly touchKeys = new Set<string>();
  private readonly velocity = new THREE.Vector3();
  private readonly knockbackVelocity = new THREE.Vector3();
  private readonly playerPosition = new THREE.Vector3(0, 0, 5);
  private readonly hitDirection = new THREE.Vector3();
  private readonly movementDirection = new THREE.Vector3();
  private readonly playerRight = new THREE.Vector3();
  private readonly deathCameraStartPosition = new THREE.Vector3();
  private readonly deathCameraPosition = new THREE.Vector3();
  private readonly deathCameraLookTarget = new THREE.Vector3();
  private readonly lookSensitivity: number;
  private cameraView: CameraView = 'first-person';
  private jumpHeld = false;
  private verticalVelocity = 0;
  private yaw = 0;
  private pitch = 0;
  private cameraRoll = 0;
  private touchLookPointerId: number | undefined;
  private lastTouchLookX = 0;
  private lastTouchLookY = 0;
  private touchInputDetected = false;
  private mouseFallback = false;
  private animationFrame = 0;
  private disposed = false;
  private gameOver = false;
  private deathElapsed = 0;
  private paused = true;
  private mouseAttackHeld = false;
  private mouseFocusHeld = false;
  private nextAttackAt = 0;

  constructor(container: HTMLElement, map: ArenaMap, lookSensitivity = 1) {
    this.lookSensitivity = lookSensitivity;
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'game-canvas';
    container.appendChild(this.canvas);
    const hudElements = this.createHud(container);
    this.hud = hudElements.hud;
    this.attackStatus = hudElements.attackStatus;
    this.spawnProtectionMessage = hudElements.spawnProtectionMessage;
    this.deathScreen = hudElements.deathScreen;
    this.playerHealthElements = hudElements.playerHealth;
    this.touchControls = this.createTouchControls(container);

    this.player.addEventListener('healthchange', this.onPlayerHealthChange);

    this.renderer = new THREE.WebGLRenderer({
      canvas: this.canvas,
      antialias: true,
      powerPreference: 'high-performance',
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;

    this.camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 160);
    this.camera.rotation.order = 'YXZ';
    this.playerMesh = new THREE.Mesh(
      new THREE.BoxGeometry(this.player.width, this.player.height, this.player.length),
      new THREE.MeshStandardMaterial({ color: 0x888888, roughness: 0.85 }),
    );
    this.playerMesh.position.set(this.playerPosition.x, this.player.height / 2, this.playerPosition.z);
    this.scene.add(this.playerMesh);

    buildMap(this.scene, map);
    this.spawnHostileMobs();
    this.attachEvents();
    this.updateCamera(0);
    this.animate();
  }

  destroy(): void {
    this.disposed = true;
    cancelAnimationFrame(this.animationFrame);
    this.clearKeys();
    document.removeEventListener('keydown', this.onKeyDown);
    document.removeEventListener('keyup', this.onKeyUp);
    document.removeEventListener('mousemove', this.onMouseMove);
    document.removeEventListener('mousedown', this.onMouseDown);
    document.removeEventListener('mouseup', this.onMouseUp);
    document.removeEventListener('pointerlockchange', this.onPointerLockChange);
    this.player.removeEventListener('healthchange', this.onPlayerHealthChange);
    this.hostileMobs.forEach((mob) => mob.dispose());
    window.removeEventListener('resize', this.onResize);
    window.removeEventListener('blur', this.clearKeys);
    window.removeEventListener('pointerup', this.onAnyTouchPointerEnd);
    this.canvas.removeEventListener('click', this.onCanvasClick);
    this.canvas.removeEventListener('pointerdown', this.onCanvasPointerDown);
    this.canvas.removeEventListener('pointermove', this.onCanvasPointerMove);
    this.canvas.removeEventListener('pointerup', this.onCanvasPointerEnd);
    this.canvas.removeEventListener('pointercancel', this.onCanvasPointerEnd);
    this.canvas.removeEventListener('wheel', this.onWheel);
    this.canvas.removeEventListener('contextmenu', this.onContextMenu);
    this.renderer.dispose();
    if (document.pointerLockElement === this.canvas) document.exitPointerLock();
    for (let index = this.playerProjectiles.length - 1; index >= 0; index -= 1) {
      this.removePlayerProjectile(index);
    }
    this.scene.traverse((object) => {
      if (!(object instanceof THREE.Mesh || object instanceof THREE.Line)) return;
      object.geometry.dispose();
      const materials = Array.isArray(object.material) ? object.material : [object.material];
      materials.forEach((material) => material.dispose());
    });
    this.scene.clear();
    this.canvas.remove();
    this.hud.remove();
    this.deathScreen.remove();
    this.touchControls.remove();
  }

  private createHud(container: HTMLElement): {
    hud: HTMLElement;
    deathScreen: HTMLElement;
    spawnProtectionMessage: HTMLElement;
    attackStatus: HTMLElement;
    playerHealth: { label: HTMLElement; track: HTMLElement; fill: HTMLElement };
  } {
    const hud = document.createElement('aside');
    hud.className = 'game-hud';
    hud.setAttribute('aria-label', 'Game status');

    const crosshair = document.createElement('div');
    crosshair.className = 'game-crosshair';
    crosshair.setAttribute('aria-hidden', 'true');
    hud.appendChild(crosshair);

    const attackStatus = document.createElement('div');
    attackStatus.className = 'combat-note attack-status';
    attackStatus.setAttribute('aria-live', 'polite');
    hud.appendChild(attackStatus);
    this.updateAttackStatus(attackStatus);

    const spawnProtectionMessage = document.createElement('div');
    spawnProtectionMessage.className = 'spawn-protection-message';
    spawnProtectionMessage.setAttribute('role', 'status');
    spawnProtectionMessage.textContent = 'Spawn protected — click the game to start.';
    hud.appendChild(spawnProtectionMessage);

    const deathScreen = document.createElement('div');
    deathScreen.className = 'death-screen';
    deathScreen.setAttribute('role', 'status');
    deathScreen.setAttribute('aria-live', 'assertive');
    deathScreen.hidden = true;
    const deathCard = document.createElement('div');
    deathCard.className = 'death-card';
    const deathTitle = document.createElement('h1');
    deathTitle.textContent = 'Dead';
    const deathPrompt = document.createElement('p');
    deathPrompt.textContent = 'Press Esc to return to the menu';
    deathCard.append(deathTitle, deathPrompt);
    deathScreen.appendChild(deathCard);
    container.appendChild(deathScreen);

    const playerHealth = document.createElement('div');
    playerHealth.className = 'player-health';
    const playerHealthLabel = document.createElement('div');
    playerHealthLabel.className = 'mob-health-label';
    playerHealthLabel.textContent = `Player: ${this.player.health} / ${this.player.maxHealth}`;
    const playerHealthTrack = document.createElement('div');
    playerHealthTrack.className = 'mob-health-track';
    playerHealthTrack.setAttribute('role', 'progressbar');
    playerHealthTrack.setAttribute('aria-label', 'Player health');
    playerHealthTrack.setAttribute('aria-valuemin', '0');
    playerHealthTrack.setAttribute('aria-valuemax', String(this.player.maxHealth));
    playerHealthTrack.setAttribute('aria-valuenow', String(this.player.health));
    const playerHealthFill = document.createElement('div');
    playerHealthFill.className = 'player-health-fill';
    playerHealthTrack.appendChild(playerHealthFill);
    playerHealth.append(playerHealthLabel, playerHealthTrack);
    hud.appendChild(playerHealth);

    const mobList = document.createElement('div');
    mobList.className = 'mob-health-list';
    mobList.setAttribute('aria-label', 'Hostile mob health');

    for (const definition of HOSTILE_MOBS) {
      const card = document.createElement('div');
      card.className = 'mob-health-card';
      const label = document.createElement('div');
      label.className = 'mob-health-label';
      label.textContent = `${definition.name}: ${definition.healthPoints} / ${definition.healthPoints}`;
      const track = document.createElement('div');
      track.className = 'mob-health-track';
      const fill = document.createElement('div');
      fill.className = `mob-health-fill mob-health-${definition.id}`;
      track.appendChild(fill);
      card.append(label, track);
      mobList.appendChild(card);
      this.mobHealthRows.set(definition.id, { card, fill, label });
    }

    hud.appendChild(mobList);
    container.appendChild(hud);
    return {
      hud,
      deathScreen,
      spawnProtectionMessage,
      attackStatus,
      playerHealth: {
        label: playerHealthLabel,
        track: playerHealthTrack,
        fill: playerHealthFill,
      },
    };
  }

  private createTouchControls(container: HTMLElement): HTMLElement {
    const controls = document.createElement('section');
    controls.className = 'touch-controls';
    controls.setAttribute('aria-label', 'Touch game controls');
    controls.innerHTML = `
      <div class="touch-group touch-movement" aria-label="Movement">
        <button class="touch-button touch-up" type="button" data-hold-key="KeyW" aria-label="Move forward">▲</button>
        <button class="touch-button touch-left" type="button" data-hold-key="KeyA" aria-label="Move left">◀</button>
        <button class="touch-button touch-down" type="button" data-hold-key="KeyS" aria-label="Move backward">▼</button>
        <button class="touch-button touch-right" type="button" data-hold-key="KeyD" aria-label="Move right">▶</button>
      </div>
      <div class="touch-group touch-core" aria-label="Movement actions">
        <button class="touch-button" type="button" data-hold-key="Space">Jump</button>
        <button class="touch-button" type="button" data-hold-key="ShiftLeft">Sprint</button>
        <button class="touch-button" type="button" data-hold-key="ControlLeft">Crouch</button>
        <button class="touch-button" type="button" data-camera-view>Camera</button>
        <button class="touch-button" type="button" data-hold-action="focus">Focus</button>
        <button class="touch-button touch-primary" type="button" data-hold-action="attack">Attack</button>
        <button class="touch-button" type="button" data-game-exit>Menu</button>
      </div>
      <div class="touch-toolbar" aria-label="Combat and game actions">
        <div class="touch-group" aria-label="Select attack">
          <button class="touch-button" type="button" data-attack-index="0">Fists</button>
          <button class="touch-button" type="button" data-attack-index="1">Melee</button>
          <button class="touch-button" type="button" data-attack-index="2">Shooter</button>
        </div>
        <div class="touch-group" aria-label="Other actions">
          <button class="touch-button" type="button" data-action="reload">Reload</button>
          <button class="touch-button" type="button" data-action="defend">Defend</button>
          <button class="touch-button" type="button" data-action="equip">Equip</button>
          <button class="touch-button" type="button" data-action="special">Special</button>
          <button class="touch-button" type="button" data-weapon-swap="-1">Previous weapon</button>
          <button class="touch-button" type="button" data-weapon-swap="1">Next weapon</button>
        </div>
        <div class="touch-group touch-elements" aria-label="Select element">
          ${Array.from({ length: 9 }, (_, index) => `<button class="touch-button" type="button" data-element-slot="${index + 1}">Element ${index + 1}</button>`).join('')}
        </div>
      </div>
    `;
    controls.addEventListener('pointerdown', this.onTouchPointerDown);
    controls.addEventListener('pointerup', this.onTouchPointerEnd);
    controls.addEventListener('pointercancel', this.onTouchPointerEnd);
    controls.addEventListener('lostpointercapture', this.onTouchPointerEnd);
    controls.addEventListener('click', this.onTouchClick);
    container.appendChild(controls);
    return controls;
  }

  private spawnHostileMobs(): void {
    const spawnRadius = Math.max(14, MINIMUM_HOSTILE_SPAWN_DISTANCE);
    HOSTILE_MOBS.forEach((definition, index) => {
      const angle = (index / HOSTILE_MOBS.length) * Math.PI * 2;
      const flying = definition.id === 'flying-attacker';
      const position = new THREE.Vector3(
        this.playerPosition.x + Math.cos(angle) * spawnRadius,
        flying ? this.playerPosition.y + 7 : definition.dimensions.height / 2,
        this.playerPosition.z + Math.sin(angle) * spawnRadius,
      );
      this.hostileMobs.push(new HostileMob(
        definition,
        this.scene,
        position,
        (damage, attackDirection) => this.onHostileHitPlayer(damage, attackDirection),
        (health) => this.updateMobHealth(health),
      ));
    });
  }

  private updateMobHealth(health: HostileMobHealth): void {
    const row = this.mobHealthRows.get(health.id);
    if (!row) return;
    row.label.textContent = health.defeated
      ? `${health.name}: Defeated`
      : `${health.name}: ${health.health} / ${health.maxHealth}`;
    row.fill.style.width = `${(health.health / health.maxHealth) * 100}%`;
    row.card.classList.toggle('is-defeated', health.defeated);
  }

  private updateHostileMobs(delta: number): void {
    for (const mob of this.hostileMobs) mob.update(delta, this.playerPosition, this.yaw);
  }

  private attachEvents(): void {
    document.addEventListener('keydown', this.onKeyDown);
    document.addEventListener('keyup', this.onKeyUp);
    document.addEventListener('mousemove', this.onMouseMove);
    document.addEventListener('mousedown', this.onMouseDown);
    document.addEventListener('mouseup', this.onMouseUp);
    document.addEventListener('pointerlockchange', this.onPointerLockChange);
    window.addEventListener('resize', this.onResize);
    window.addEventListener('blur', this.clearKeys);
    this.canvas.addEventListener('click', this.onCanvasClick);
    this.canvas.addEventListener('pointerdown', this.onCanvasPointerDown);
    this.canvas.addEventListener('pointermove', this.onCanvasPointerMove);
    this.canvas.addEventListener('pointerup', this.onCanvasPointerEnd);
    this.canvas.addEventListener('pointercancel', this.onCanvasPointerEnd);
    this.canvas.addEventListener('wheel', this.onWheel, { passive: false });
    this.canvas.addEventListener('contextmenu', this.onContextMenu);
    window.addEventListener('pointerup', this.onAnyTouchPointerEnd);
  }

  private onKeyDown = (event: KeyboardEvent): void => {
    if (this.gameOver) return;
    if (event.repeat) return;

    const attackSlot = this.getAttackSlot(event.code);
    if (attackSlot !== undefined) {
      this.selectAttack(attackSlot);
      return;
    }
    if (this.paused) return;

    if (event.code === 'Space') {
      event.preventDefault();
      this.jumpHeld = true;
      return;
    }

    if (event.code === 'KeyL') {
      this.toggleCameraView();
      return;
    }

    if (this.isMovementKey(event.code)) {
      this.keys.add(event.code);
      return;
    }

    const actions: Partial<Record<string, GameAction>> = {
      KeyR: 'reload',
      KeyQ: 'defend',
      KeyE: 'equip',
      KeyB: 'special',
    };
    const action = actions[event.code];
    if (action) {
      this.emitAction(action);
      return;
    }

    const elementSlot = this.getElementSlot(event.code);
    if (elementSlot !== undefined) this.emitAction('element-select', elementSlot);
  };

  private onKeyUp = (event: KeyboardEvent): void => {
    this.keys.delete(event.code);
    if (event.code === 'Space') this.jumpHeld = this.isKeyDown('Space');
  };

  private clearKeys = (): void => {
    this.keys.clear();
    this.touchKeys.clear();
    this.touchControls.querySelectorAll<HTMLButtonElement>('button[data-pressed="true"]')
      .forEach((button) => {
        delete button.dataset.pressed;
        button.classList.remove('is-pressed');
      });
    this.jumpHeld = false;
    this.mouseAttackHeld = false;
    this.mouseFocusHeld = false;
    this.verticalVelocity = 0;
    this.emitAction('attack', false);
    this.emitAction('focus', false);
  };

  private onMouseDown = (event: MouseEvent): void => {
    if (this.gameOver || this.paused || event.target !== this.canvas) return;
    if (event.button === 0) {
      this.mouseAttackHeld = true;
      this.emitAction('attack', true);
      this.performAttack();
    }
    if (event.button === 2) {
      this.mouseFocusHeld = true;
      this.emitAction('focus', true);
    }
  };

  private performAttack(): void {
    const attack = this.player.selectedAttack;
    const now = performance.now();
    if (now < this.nextAttackAt) return;
    this.nextAttackAt = now + attack.attackCooldownSeconds * 1000;

    this.camera.updateMatrixWorld(true);
    const direction = this.camera.getWorldDirection(new THREE.Vector3()).normalize();
    if (attack.mode === 'melee') {
      this.raycaster.set(this.camera.position, direction);
      this.raycaster.far = attack.attackRange;
      const targets = this.hostileMobs
        .filter((mob) => !mob.isDefeated)
        .map((mob) => {
          mob.mesh.updateMatrixWorld(true);
          return mob.mesh;
        });
      const [hit] = this.raycaster.intersectObjects(targets, false);
      if (hit) {
        this.hostileMobs.find((mob) => mob.mesh === hit.object)
          ?.takeDamage(attack.attackDamage, direction);
      }
      return;
    }

    const material = new THREE.MeshBasicMaterial({
      color: 0xffe29a,
      toneMapped: false,
    });
    const mesh = new THREE.Mesh(new THREE.SphereGeometry(0.11, 10, 10), material);
    mesh.position.copy(this.camera.position).addScaledVector(direction, 0.45);
    this.scene.add(mesh);
    this.playerProjectiles.push({
      mesh,
      direction,
      remainingRange: attack.attackRange,
      speed: attack.projectileSpeed ?? 35,
      damage: attack.attackDamage,
    });
  }

  private updatePlayerProjectiles(delta: number): void {
    for (let index = this.playerProjectiles.length - 1; index >= 0; index -= 1) {
      const projectile = this.playerProjectiles[index];
      const step = Math.min(
        projectile.speed * delta,
        projectile.remainingRange,
      );
      this.raycaster.set(projectile.mesh.position, projectile.direction);
      this.raycaster.far = step + 0.12;
      const targets = this.hostileMobs
        .filter((mob) => !mob.isDefeated)
        .map((mob) => {
          mob.mesh.updateMatrixWorld(true);
          return mob.mesh;
        });
      const [hit] = this.raycaster.intersectObjects(targets, false);
      if (hit) {
        this.hostileMobs.find((mob) => mob.mesh === hit.object)
          ?.takeDamage(projectile.damage, projectile.direction);
        this.removePlayerProjectile(index);
        continue;
      }

      projectile.mesh.position.addScaledVector(projectile.direction, step);
      projectile.remainingRange -= step;
      if (projectile.remainingRange <= 0) this.removePlayerProjectile(index);
    }
  }

  private removePlayerProjectile(index: number): void {
    const [projectile] = this.playerProjectiles.splice(index, 1);
    this.scene.remove(projectile.mesh);
    projectile.mesh.geometry.dispose();
    const material = projectile.mesh.material;
    if (Array.isArray(material)) material.forEach((item) => item.dispose());
    else material.dispose();
  }

  private onMouseUp = (event: MouseEvent): void => {
    if (event.button === 0 && this.mouseAttackHeld) {
      this.mouseAttackHeld = false;
      this.emitAction('attack', false);
    }
    if (event.button === 2 && this.mouseFocusHeld) {
      this.mouseFocusHeld = false;
      this.emitAction('focus', false);
    }
  };

  private onWheel = (event: WheelEvent): void => {
    event.preventDefault();
    if (event.deltaY === 0) return;
    this.changeWeapon(Math.sign(event.deltaY));
  };

  private onTouchPointerDown = (event: PointerEvent): void => {
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>('button');
    if (!button || !this.touchControls.contains(button)) return;
    event.preventDefault();
    if (this.gameOver && !button.hasAttribute('data-game-exit')) return;
    if (this.paused) this.startGame();

    const holdKey = button.dataset.holdKey;
    if (holdKey) {
      button.dataset.pressed = 'true';
      button.classList.add('is-pressed');
      this.touchKeys.add(holdKey);
      if (holdKey === 'Space') this.jumpHeld = true;
      button.setPointerCapture(event.pointerId);
      return;
    }

    const holdAction = button.dataset.holdAction as GameAction | undefined;
    if (!holdAction) return;
    button.dataset.pressed = 'true';
    button.classList.add('is-pressed');
    this.emitAction(holdAction, true);
    if (holdAction === 'attack') this.performAttack();
    button.setPointerCapture(event.pointerId);
  };

  private onTouchPointerEnd = (event: PointerEvent): void => {
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>('button');
    if (!button || !this.touchControls.contains(button)) return;
    this.releaseTouchButton(button);
  };

  private onAnyTouchPointerEnd = (event: PointerEvent): void => {
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>('button');
    if (button && this.touchControls.contains(button)) this.releaseTouchButton(button);
  };

  private releaseTouchButton(button: HTMLButtonElement): void {
    if (button.dataset.pressed !== 'true') return;
    delete button.dataset.pressed;
    button.classList.remove('is-pressed');

    const holdKey = button.dataset.holdKey;
    if (holdKey) {
      this.touchKeys.delete(holdKey);
      if (holdKey === 'Space') this.jumpHeld = this.isKeyDown('Space');
    }

    const holdAction = button.dataset.holdAction as GameAction | undefined;
    if (holdAction) this.emitAction(holdAction, false);
  }

  private onTouchClick = (event: MouseEvent): void => {
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>('button');
    if (!button || !this.touchControls.contains(button)) return;
    if (this.gameOver && !button.hasAttribute('data-game-exit')) return;
    if (this.paused) this.startGame();

    const attackIndex = Number(button.dataset.attackIndex);
    if (button.dataset.attackIndex !== undefined) {
      this.selectAttack(attackIndex);
      return;
    }

    const action = button.dataset.action as GameAction | undefined;
    if (action) {
      this.emitAction(action);
      return;
    }

    if (button.dataset.elementSlot !== undefined) {
      this.emitAction('element-select', Number(button.dataset.elementSlot));
      return;
    }

    if (button.dataset.weaponSwap !== undefined) {
      this.changeWeapon(Number(button.dataset.weaponSwap));
      return;
    }

    if (button.hasAttribute('data-camera-view')) {
      this.toggleCameraView();
      return;
    }

    if (button.hasAttribute('data-game-exit')) {
      this.canvas.dispatchEvent(new Event('gameexit', { bubbles: true }));
    }
  };

  private changeWeapon(direction: number): void {
    if (direction === 0) return;
    this.selectAttack(
      (this.player.selectedAttackIndex + Math.sign(direction) + PLAYER_ATTACKS.length)
        % PLAYER_ATTACKS.length,
    );
    this.emitAction('weapon-swap', Math.sign(direction));
  }

  private onContextMenu = (event: MouseEvent): void => {
    event.preventDefault();
  };

  private isMovementKey(code: string): boolean {
    return [
      'KeyW', 'KeyA', 'KeyS', 'KeyD',
      'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight',
      'ShiftLeft', 'ShiftRight', 'ControlLeft', 'ControlRight',
    ].includes(code);
  }

  private getElementSlot(code: string): number | undefined {
    const match = /^(?:Digit|Numpad)([1-9])$/.exec(code);
    return match ? Number(match[1]) : undefined;
  }

  private getAttackSlot(code: string): number | undefined {
    const match = /^(?:Digit|Numpad)([1-3])$/.exec(code);
    return match ? Number(match[1]) - 1 : undefined;
  }

  private selectAttack(index: number): void {
    if (!this.player.selectAttack(index)) return;
    this.updateAttackStatus(this.attackStatus);
    this.canvas.dispatchEvent(new CustomEvent<{ id: PlayerAttackId; index: number }>('attackselect', {
      bubbles: true,
      detail: { id: this.player.selectedAttack.id, index },
    }));
  }

  private updateAttackStatus(element: HTMLElement): void {
    const attack = this.player.selectedAttack;
    element.textContent = `Selected: ${attack.name} (${attack.attackDamage} damage, ${attack.attackRange} range) — 1–3 or scroll`;
  }

  private isCrouching(): boolean {
    return this.isKeyDown('ControlLeft') || this.isKeyDown('ControlRight');
  }

  private isKeyDown(code: string): boolean {
    return this.keys.has(code) || this.touchKeys.has(code);
  }

  private emitAction(action: GameAction, value?: number | boolean): void {
    const detail: GameActionDetail = value === undefined ? { action } : { action, value };
    this.canvas.dispatchEvent(new CustomEvent<GameActionDetail>('gameaction', {
      bubbles: true,
      detail,
    }));
  }

  private onPlayerHealthChange = (event: Event): void => {
    const { health, maxHealth } = (event as CustomEvent<PlayerHealthChange>).detail;
    this.playerHealthElements.label.textContent = `Player: ${health} / ${maxHealth}`;
    this.playerHealthElements.track.setAttribute('aria-valuenow', String(health));
    this.playerHealthElements.fill.style.width = `${(health / maxHealth) * 100}%`;
    if (health === 0 && !this.gameOver) {
      this.gameOver = true;
      this.deathElapsed = 0;
      this.deathCameraStartPosition.copy(this.camera.position);
      this.playerMesh.visible = true;
      this.deathScreen.hidden = false;
      this.clearKeys();
    }
    this.canvas.dispatchEvent(new CustomEvent<PlayerHealthChange>('playerhealthchange', {
      bubbles: true,
      detail: { health, maxHealth },
    }));
  };

  private onHostileHitPlayer(damage: number, attackDirection: THREE.Vector3): void {
    if (this.gameOver) return;
    this.player.takeDamage(damage);

    this.hitDirection.copy(attackDirection).setY(0);
    if (this.hitDirection.lengthSq() < 0.001) {
      this.hitDirection.set(Math.sin(this.yaw), 0, Math.cos(this.yaw));
    }
    this.hitDirection.normalize().multiplyScalar(0.75);
    if (this.velocity.lengthSq() > 0.01) {
      this.movementDirection.copy(this.velocity).setY(0).normalize();
      this.hitDirection.addScaledVector(this.movementDirection, 0.25);
    }
    if (this.hitDirection.lengthSq() > 0) this.hitDirection.normalize();
    this.knockbackVelocity.addScaledVector(this.hitDirection, PLAYER_KNOCKBACK_FORCE);

    this.playerRight.set(Math.cos(this.yaw), 0, -Math.sin(this.yaw));
    const lateralHit = this.hitDirection.dot(this.playerRight);
    this.cameraRoll = THREE.MathUtils.clamp(
      this.cameraRoll - lateralHit * CAMERA_HIT_TILT,
      -0.35,
      0.35,
    );
  }

  private toggleCameraView(): void {
    this.cameraView = this.cameraView === 'first-person' ? 'floating' : 'first-person';
    this.canvas.dispatchEvent(new CustomEvent<{ view: CameraView }>('cameraviewchange', {
      bubbles: true,
      detail: { view: this.cameraView },
    }));
  }

  private onMouseMove = (event: MouseEvent): void => {
    if (
      this.gameOver
      || (document.pointerLockElement !== this.canvas && !this.mouseFallback)
    ) return;
    this.updateLook(event.movementX, event.movementY);
  };

  private onCanvasClick = (): void => {
    if (this.gameOver) return;
    if (this.paused) this.startGame();
    if (!this.touchInputDetected && document.pointerLockElement !== this.canvas) {
      void this.requestPointerLock();
    }
  };

  private onCanvasPointerDown = (event: PointerEvent): void => {
    if (event.pointerType !== 'touch' || this.gameOver) return;
    event.preventDefault();
    this.touchInputDetected = true;
    if (this.paused) this.startGame();
    this.touchLookPointerId = event.pointerId;
    this.lastTouchLookX = event.clientX;
    this.lastTouchLookY = event.clientY;
    this.canvas.setPointerCapture(event.pointerId);
  };

  private onCanvasPointerMove = (event: PointerEvent): void => {
    if (event.pointerId !== this.touchLookPointerId || this.gameOver) return;
    this.updateLook(
      event.clientX - this.lastTouchLookX,
      event.clientY - this.lastTouchLookY,
    );
    this.lastTouchLookX = event.clientX;
    this.lastTouchLookY = event.clientY;
  };

  private onCanvasPointerEnd = (event: PointerEvent): void => {
    if (event.pointerId === this.touchLookPointerId) this.touchLookPointerId = undefined;
  };

  private updateLook(movementX: number, movementY: number): void {
    this.yaw -= movementX * 0.0022 * this.lookSensitivity;
    this.pitch = THREE.MathUtils.clamp(
      this.pitch - movementY * 0.0022 * this.lookSensitivity,
      -1.48,
      1.48,
    );
    if (this.cameraView === 'first-person') {
      this.camera.rotation.set(this.pitch, this.yaw, this.cameraRoll);
    }
  }

  private startGame(): void {
    if (!this.paused || this.gameOver) return;
    this.paused = false;
    this.spawnProtectionMessage.hidden = true;
  }

  private async requestPointerLock(): Promise<void> {
    try {
      await this.canvas.requestPointerLock();
      this.mouseFallback = false;
    } catch (error) {
      console.warn('Pointer lock is unavailable; using unlocked mouse look.', error);
      this.mouseFallback = true;
    }
  }

  private onPointerLockChange = (): void => {
    if (document.pointerLockElement === this.canvas) {
      this.mouseFallback = false;
      this.canvas.style.cursor = 'none';
      return;
    }
    this.mouseFallback = false;
    this.canvas.style.cursor = 'crosshair';
  };

  private onResize = (): void => {
    this.camera.aspect = window.innerWidth / window.innerHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(window.innerWidth, window.innerHeight);
  };

  private updateCamera(delta: number): void {
    const forwardInput = Number(this.isKeyDown('KeyW') || this.isKeyDown('ArrowUp'))
      - Number(this.isKeyDown('KeyS') || this.isKeyDown('ArrowDown'));
    const strafeInput = Number(this.isKeyDown('KeyD') || this.isKeyDown('ArrowRight'))
      - Number(this.isKeyDown('KeyA') || this.isKeyDown('ArrowLeft'));

    const direction = new THREE.Vector3(
      -Math.sin(this.yaw) * forwardInput + Math.cos(this.yaw) * strafeInput,
      0,
      -Math.cos(this.yaw) * forwardInput - Math.sin(this.yaw) * strafeInput,
    );
    if (direction.lengthSq() > 0) direction.normalize();

    const crouching = this.isCrouching();
    const sprinting = !crouching
      && (this.isKeyDown('ShiftLeft') || this.isKeyDown('ShiftRight'));
    const speed = crouching ? CROUCH_SPEED : sprinting ? SPRINT_SPEED : WALK_SPEED;
    this.velocity.lerp(direction.multiplyScalar(speed), 1 - Math.exp(-14 * delta));
    this.playerPosition.addScaledVector(this.velocity, delta);
    this.playerPosition.addScaledVector(this.knockbackVelocity, delta);
    this.knockbackVelocity.multiplyScalar(Math.exp(-5 * delta));
    this.cameraRoll *= Math.exp(-4 * delta);
    const playerFootprintRadius = Math.hypot(this.player.width, this.player.length) / 2;
    this.playerPosition.x = THREE.MathUtils.clamp(
      this.playerPosition.x,
      -ARENA_HALF_EXTENT + playerFootprintRadius,
      ARENA_HALF_EXTENT - playerFootprintRadius,
    );
    this.playerPosition.z = THREE.MathUtils.clamp(
      this.playerPosition.z,
      -ARENA_HALF_EXTENT + playerFootprintRadius,
      ARENA_HALF_EXTENT - playerFootprintRadius,
    );

    const grounded = this.playerPosition.y <= 0;
    if (this.jumpHeld && grounded && !crouching) this.verticalVelocity = JUMP_SPEED;
    this.verticalVelocity -= GRAVITY * delta;
    this.playerPosition.y += this.verticalVelocity * delta;
    if (this.playerPosition.y < 0) {
      this.playerPosition.y = 0;
      this.verticalVelocity = 0;
    }

    const targetHeight = crouching ? CROUCHING_HEIGHT : this.player.height;
    this.playerMesh.position.set(
      this.playerPosition.x,
      this.playerPosition.y + targetHeight / 2,
      this.playerPosition.z,
    );
    this.playerMesh.scale.y = targetHeight / this.player.height;
    this.playerMesh.rotation.y = this.yaw;
    this.playerMesh.visible = this.cameraView === 'floating';

    if (this.cameraView === 'first-person') {
      this.camera.position.copy(this.playerPosition).add(new THREE.Vector3(0, targetHeight * 0.9, 0));
      this.camera.rotation.set(this.pitch, this.yaw, this.cameraRoll);
      return;
    }

    const cameraDistance = 5;
    this.camera.position.set(
      this.playerPosition.x - Math.sin(this.yaw) * cameraDistance,
      this.playerPosition.y + targetHeight + 0.35,
      this.playerPosition.z + Math.cos(this.yaw) * cameraDistance,
    );
    this.camera.rotation.set(this.pitch, this.yaw, this.cameraRoll);
  }

  private updateDeathCinematic(delta: number): void {
    this.deathElapsed = Math.min(this.deathElapsed + delta, DEATH_CINEMATIC_DURATION);
    const progress = this.deathElapsed / DEATH_CINEMATIC_DURATION;
    const easedProgress = progress * progress * (3 - 2 * progress);
    const angle = this.yaw + easedProgress * 1.4;

    this.playerMesh.position.set(
      this.playerPosition.x,
      this.playerPosition.y + this.player.height / 2,
      this.playerPosition.z,
    );
    this.playerMesh.rotation.set(0, this.yaw, easedProgress * Math.PI / 2);

    this.deathCameraPosition.set(
      this.playerPosition.x + Math.cos(angle) * 4,
      this.playerPosition.y + 2.4,
      this.playerPosition.z + Math.sin(angle) * 4,
    );
    this.camera.position.copy(this.deathCameraStartPosition)
      .lerp(this.deathCameraPosition, easedProgress);
    this.deathCameraLookTarget.set(
      this.playerPosition.x,
      this.playerPosition.y + 0.75,
      this.playerPosition.z,
    );
    this.camera.lookAt(this.deathCameraLookTarget);

    if (this.deathElapsed < DEATH_CINEMATIC_DURATION) {
      const slowMotionDelta = delta * DEATH_SLOW_MOTION_SCALE;
      this.updatePlayerProjectiles(slowMotionDelta);
      this.updateHostileMobs(slowMotionDelta);
    }
  }

  private animate = (): void => {
    if (this.disposed) return;
    const delta = Math.min(this.clock.getDelta(), 0.05);
    if (this.gameOver) {
      this.updateDeathCinematic(delta);
    } else if (!this.paused) {
      this.updateCamera(delta);
      this.updatePlayerProjectiles(delta);
      this.updateHostileMobs(delta);
    }
    this.renderer.render(this.scene, this.camera);
    this.animationFrame = requestAnimationFrame(this.animate);
  };
}
