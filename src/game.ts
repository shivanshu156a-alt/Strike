import * as THREE from 'three';
import { ARENA_GRID_SIZE, GRID_UNIT_SIZE, buildMap, type ArenaMap } from './maps';
import { Player, type PlayerHealthChange, type WeaponCombatProfile } from './player';

const ARENA_HALF_EXTENT = ARENA_GRID_SIZE * GRID_UNIT_SIZE / 2;
const CROUCHING_HEIGHT = 1.05;
const WALK_SPEED = 8;
const SPRINT_SPEED = 14;
const CROUCH_SPEED = 4;
const JUMP_SPEED = 7;
const GRAVITY = 20;

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
  private readonly canvas: HTMLCanvasElement;
  private readonly playerMesh: THREE.Mesh;
  private readonly keys = new Set<string>();
  private readonly velocity = new THREE.Vector3();
  private readonly playerPosition = new THREE.Vector3(0, 0, 5);
  private readonly lookSensitivity: number;
  private cameraView: CameraView = 'first-person';
  private jumpHeld = false;
  private verticalVelocity = 0;
  private yaw = 0;
  private pitch = 0;
  private mouseFallback = false;
  private animationFrame = 0;
  private disposed = false;

  constructor(container: HTMLElement, map: ArenaMap, lookSensitivity = 1) {
    this.lookSensitivity = lookSensitivity;
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'game-canvas';
    container.appendChild(this.canvas);

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
    window.removeEventListener('resize', this.onResize);
    window.removeEventListener('blur', this.clearKeys);
    this.canvas.removeEventListener('click', this.onCanvasClick);
    this.canvas.removeEventListener('wheel', this.onWheel);
    this.canvas.removeEventListener('contextmenu', this.onContextMenu);
    this.renderer.dispose();
    if (document.pointerLockElement === this.canvas) document.exitPointerLock();
    this.scene.remove(this.playerMesh);
    this.playerMesh.geometry.dispose();
    const playerMaterial = this.playerMesh.material;
    if (Array.isArray(playerMaterial)) {
      playerMaterial.forEach((material) => material.dispose());
    } else {
      playerMaterial.dispose();
    }
    this.canvas.remove();
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
    this.canvas.addEventListener('wheel', this.onWheel, { passive: false });
    this.canvas.addEventListener('contextmenu', this.onContextMenu);
  }

  private onKeyDown = (event: KeyboardEvent): void => {
    if (event.code === 'Space') {
      event.preventDefault();
      this.jumpHeld = true;
      return;
    }
    if (event.repeat) return;

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
    if (event.code === 'Space') this.jumpHeld = false;
  };

  private clearKeys = (): void => {
    this.keys.clear();
    this.jumpHeld = false;
    this.verticalVelocity = 0;
    this.emitAction('attack', false);
    this.emitAction('focus', false);
  };

  private onMouseDown = (event: MouseEvent): void => {
    if (event.target !== this.canvas) return;
    if (event.button === 0) this.emitAction('attack', true);
    if (event.button === 2) this.emitAction('focus', true);
  };

  private onMouseUp = (event: MouseEvent): void => {
    if (event.button === 0) this.emitAction('attack', false);
    if (event.button === 2) this.emitAction('focus', false);
  };

  private onWheel = (event: WheelEvent): void => {
    event.preventDefault();
    if (event.deltaY !== 0) this.emitAction('weapon-swap', Math.sign(event.deltaY));
  };

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

  private isCrouching(): boolean {
    return this.keys.has('ControlLeft') || this.keys.has('ControlRight');
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
    this.canvas.dispatchEvent(new CustomEvent<PlayerHealthChange>('playerhealthchange', {
      bubbles: true,
      detail: { health, maxHealth },
    }));
  };

  private toggleCameraView(): void {
    this.cameraView = this.cameraView === 'first-person' ? 'floating' : 'first-person';
    this.canvas.dispatchEvent(new CustomEvent<{ view: CameraView }>('cameraviewchange', {
      bubbles: true,
      detail: { view: this.cameraView },
    }));
  }

  private onMouseMove = (event: MouseEvent): void => {
    if (document.pointerLockElement !== this.canvas && !this.mouseFallback) return;
    this.yaw -= event.movementX * 0.0022 * this.lookSensitivity;
    this.pitch = THREE.MathUtils.clamp(
      this.pitch - event.movementY * 0.0022 * this.lookSensitivity,
      -1.48,
      1.48,
    );
    if (this.cameraView === 'first-person') this.camera.rotation.set(this.pitch, this.yaw, 0);
  };

  private onCanvasClick = (): void => {
    if (document.pointerLockElement === this.canvas) return;
    void this.requestPointerLock();
  };

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
    const forwardInput = Number(this.keys.has('KeyW') || this.keys.has('ArrowUp'))
      - Number(this.keys.has('KeyS') || this.keys.has('ArrowDown'));
    const strafeInput = Number(this.keys.has('KeyD') || this.keys.has('ArrowRight'))
      - Number(this.keys.has('KeyA') || this.keys.has('ArrowLeft'));

    const direction = new THREE.Vector3(
      -Math.sin(this.yaw) * forwardInput + Math.cos(this.yaw) * strafeInput,
      0,
      -Math.cos(this.yaw) * forwardInput - Math.sin(this.yaw) * strafeInput,
    );
    if (direction.lengthSq() > 0) direction.normalize();

    const crouching = this.isCrouching();
    const sprinting = !crouching && (this.keys.has('ShiftLeft') || this.keys.has('ShiftRight'));
    const speed = crouching ? CROUCH_SPEED : sprinting ? SPRINT_SPEED : WALK_SPEED;
    this.velocity.lerp(direction.multiplyScalar(speed), 1 - Math.exp(-14 * delta));
    this.playerPosition.addScaledVector(this.velocity, delta);
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

    const focusPoint = this.playerPosition.clone().add(new THREE.Vector3(0, targetHeight * 0.58, 0));
    if (this.cameraView === 'first-person') {
      this.camera.position.copy(this.playerPosition).add(new THREE.Vector3(0, targetHeight, 0));
      this.camera.rotation.set(this.pitch, this.yaw, 0);
      return;
    }

    const cameraDistance = 5;
    const cameraPitch = this.pitch * 0.55 + 0.3;
    const horizontalDistance = cameraDistance * Math.cos(cameraPitch);
    this.camera.position.set(
      this.playerPosition.x - Math.sin(this.yaw) * horizontalDistance,
      this.playerPosition.y + 2.5 + cameraDistance * Math.sin(cameraPitch),
      this.playerPosition.z + Math.cos(this.yaw) * horizontalDistance,
    );
    this.camera.lookAt(focusPoint);
  }

  private animate = (): void => {
    if (this.disposed) return;
    const delta = Math.min(this.clock.getDelta(), 0.05);
    this.updateCamera(delta);
    this.renderer.render(this.scene, this.camera);
    this.animationFrame = requestAnimationFrame(this.animate);
  };
}
