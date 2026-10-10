import * as THREE from 'three';
import { buildMap, type ArenaMap } from './maps';

const ARENA_LIMIT = 41;
const CAMERA_MIN_HEIGHT = 0.25;
const CAMERA_MAX_HEIGHT = 35;

export class Game {
  readonly renderer: THREE.WebGLRenderer;
  readonly camera: THREE.PerspectiveCamera;

  private readonly scene = new THREE.Scene();
  private readonly clock = new THREE.Clock();
  private readonly canvas: HTMLCanvasElement;
  private readonly keys = new Set<string>();
  private readonly velocity = new THREE.Vector3();
  private yaw = 0;
  private pitch = 0;
  private mouseFallback = false;
  private animationFrame = 0;
  private disposed = false;

  constructor(container: HTMLElement, map: ArenaMap) {
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'game-canvas';
    container.appendChild(this.canvas);

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
    this.camera.position.set(0, 1.7, 5);

    buildMap(this.scene, map);
    this.attachEvents();
    this.animate();
  }

  destroy(): void {
    this.disposed = true;
    cancelAnimationFrame(this.animationFrame);
    document.removeEventListener('keydown', this.onKeyDown);
    document.removeEventListener('keyup', this.onKeyUp);
    document.removeEventListener('mousemove', this.onMouseMove);
    document.removeEventListener('pointerlockchange', this.onPointerLockChange);
    window.removeEventListener('resize', this.onResize);
    window.removeEventListener('blur', this.clearKeys);
    this.canvas.removeEventListener('click', this.onCanvasClick);
    this.renderer.dispose();
    this.canvas.remove();
  }

  private attachEvents(): void {
    document.addEventListener('keydown', this.onKeyDown);
    document.addEventListener('keyup', this.onKeyUp);
    document.addEventListener('mousemove', this.onMouseMove);
    document.addEventListener('pointerlockchange', this.onPointerLockChange);
    window.addEventListener('resize', this.onResize);
    window.addEventListener('blur', this.clearKeys);
    this.canvas.addEventListener('click', this.onCanvasClick);
  }

  private onKeyDown = (event: KeyboardEvent): void => {
    const key = event.key.toLowerCase();
    this.keys.add(key);
    if (key === ' ') event.preventDefault();
  };

  private onKeyUp = (event: KeyboardEvent): void => {
    this.keys.delete(event.key.toLowerCase());
  };

  private clearKeys = (): void => {
    this.keys.clear();
  };

  private onMouseMove = (event: MouseEvent): void => {
    if (document.pointerLockElement !== this.canvas && !this.mouseFallback) return;
    this.yaw -= event.movementX * 0.0022;
    this.pitch = THREE.MathUtils.clamp(this.pitch - event.movementY * 0.0022, -1.48, 1.48);
    this.camera.rotation.set(this.pitch, this.yaw, 0);
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
    const forwardInput = Number(this.keys.has('w') || this.keys.has('arrowup'))
      - Number(this.keys.has('s') || this.keys.has('arrowdown'));
    const strafeInput = Number(this.keys.has('d') || this.keys.has('arrowright'))
      - Number(this.keys.has('a') || this.keys.has('arrowleft'));
    const verticalInput = Number(this.keys.has(' ')) - Number(this.keys.has('control'));

    const direction = new THREE.Vector3(
      -Math.sin(this.yaw) * forwardInput + Math.cos(this.yaw) * strafeInput,
      verticalInput,
      -Math.cos(this.yaw) * forwardInput - Math.sin(this.yaw) * strafeInput,
    );
    if (direction.lengthSq() > 0) direction.normalize();

    const speed = this.keys.has('shift') ? 18 : 8;
    this.velocity.lerp(direction.multiplyScalar(speed), 1 - Math.exp(-14 * delta));
    this.camera.position.addScaledVector(this.velocity, delta);
    this.camera.position.x = THREE.MathUtils.clamp(this.camera.position.x, -ARENA_LIMIT, ARENA_LIMIT);
    this.camera.position.y = THREE.MathUtils.clamp(this.camera.position.y, CAMERA_MIN_HEIGHT, CAMERA_MAX_HEIGHT);
    this.camera.position.z = THREE.MathUtils.clamp(this.camera.position.z, -ARENA_LIMIT, ARENA_LIMIT);
  }

  private animate = (): void => {
    if (this.disposed) return;
    const delta = Math.min(this.clock.getDelta(), 0.05);
    this.updateCamera(delta);
    this.renderer.render(this.scene, this.camera);
    this.animationFrame = requestAnimationFrame(this.animate);
  };
}
