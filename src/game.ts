import * as THREE from 'three';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
import { FBXLoader } from 'three/addons/loaders/FBXLoader.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { ARENA_GRID_SIZE, GRID_UNIT_SIZE, buildMap, type ArenaMap } from './maps';
import { HOSTILE_MOBS, HostileMob, type HostileMobHealth } from './hostileMobs';
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
const DEATH_CAMERA_ORBIT_SPEED = 0.45;
const DEATH_CAMERA_START_DISTANCE = 3.5;
const DEATH_CAMERA_END_DISTANCE = 5;
const DEATH_CAMERA_START_HEIGHT = 1.6;
const DEATH_CAMERA_END_HEIGHT = 3.4;
const DEATH_CAMERA_FOLLOW_SPEED = 2.5;
const PLAYER_KNOCKBACK_FORCE = 5;
const CAMERA_HIT_TILT = 0.24;
const THIRD_PERSON_CAMERA_DISTANCE = 2.5;
const CAMERA_FOLLOW_SMOOTHING = 24;
const CAMERA_MODE_TRANSITION_DURATION = 0.2;
const PLAYER_ANIMATION_FADE_DURATION = 0.2;
const CROUCH_TRANSITION_SPEED = 2.5;
const PUNCH_ANIMATION_SPEED = 2.5;
const TOUCH_LOOK_SENSITIVITY_MULTIPLIER = 3;
const TOUCH_DOUBLE_TAP_INTERVAL = 320;
const WORLD_AIM_POINT_DISTANCE = 8;
const PLAYER_CHARACTER_URL = new URL('../3D/character.glb', import.meta.url).href;
const HOSTILE_MOB_MODEL_URLS: Partial<Record<string, string>> = {
  'normal-melee-attacker': new URL('../3D/Normal Melee Attacker.glb', import.meta.url).href,
  shooter: new URL('../3D/Shooter.glb', import.meta.url).href,
  'annoying-mob': new URL('../3D/Annoying mob.glb', import.meta.url).href,
  'teleporting-ghost': new URL('../3D/Teleporting ghost.glb', import.meta.url).href,
};
const HOSTILE_MOB_ANIMATIONS = {
  idle: 'idle',
  walking: 'walking',
  running: 'running',
  attack: 'punch',
  defeated: 'death',
} as const;

type PlayerAnimation =
  | 'idle'
  | 'walking'
  | 'running'
  | 'crouchedIdle'
  | 'crouchedWalking'
  | 'crouchDown'
  | 'crouchUp'
  | 'punch'
  | 'death'
  | 'strafeLeft'
  | 'strafeRight'
  | 'walkStrafeLeft'
  | 'walkStrafeRight'
  | 'jump'
  | 'turnLeft'
  | 'turnRight'
  | 'turnLeft90'
  | 'turnRight90';
type PlayerAnimationState = PlayerAnimation | 'stopped';

const PLAYER_ANIMATION_URLS: Record<PlayerAnimation, string> = {
  idle: new URL('../3D/idle.fbx', import.meta.url).href,
  walking: new URL('../3D/Walking.fbx', import.meta.url).href,
  running: new URL('../3D/Running.fbx', import.meta.url).href,
  crouchedIdle: new URL('../3D/Crouching Idle.fbx', import.meta.url).href,
  crouchedWalking: new URL('../3D/Crouched Walking.fbx', import.meta.url).href,
  crouchDown: new URL('../3D/Standing To Crouched.fbx', import.meta.url).href,
  crouchUp: new URL('../3D/Crouch To Stand.fbx', import.meta.url).href,
  punch: new URL('../3D/Punching.fbx', import.meta.url).href,
  death: new URL('../3D/Dying.fbx', import.meta.url).href,
  strafeLeft: new URL('../3D/left strafe.fbx', import.meta.url).href,
  strafeRight: new URL('../3D/right strafe.fbx', import.meta.url).href,
  walkStrafeLeft: new URL('../3D/left strafe walking.fbx', import.meta.url).href,
  walkStrafeRight: new URL('../3D/right strafe walking.fbx', import.meta.url).href,
  jump: new URL('../3D/jump.fbx', import.meta.url).href,
  turnLeft: new URL('../3D/left turn.fbx', import.meta.url).href,
  turnRight: new URL('../3D/right turn.fbx', import.meta.url).href,
  turnLeft90: new URL('../3D/left turn 90.fbx', import.meta.url).href,
  turnRight90: new URL('../3D/right turn 90.fbx', import.meta.url).href,
};

interface PlayerProjectile {
  mesh: THREE.Mesh;
  direction: THREE.Vector3;
  remainingRange: number;
  speed: number;
  damage: number;
}

function disposeObjectResources(root: THREE.Object3D): void {
  root.traverse((object) => {
    if (!(object instanceof THREE.Mesh || object instanceof THREE.Line)) return;
    object.geometry.dispose();
    const materials = Array.isArray(object.material) ? object.material : [object.material];
    materials.forEach((material) => {
      Object.values(material).forEach((value) => {
        if (value instanceof THREE.Texture) value.dispose();
      });
      material.dispose();
    });
  });
}

function retargetClipToCharacter(
  clip: THREE.AnimationClip,
  skinnedMeshes: readonly THREE.SkinnedMesh[],
  preserveRootRotation: boolean,
  preserveRootVerticalTranslation = false,
  requireEveryTrack = true,
): THREE.AnimationClip {
  const bonesByName = new Map<string, Set<THREE.Bone>>();
  skinnedMeshes.forEach((mesh) => {
    mesh.skeleton.bones.forEach((bone) => {
      const normalizedName = normalizeMixamoBoneName(bone.name);
      const matchingBones = bonesByName.get(normalizedName) ?? new Set<THREE.Bone>();
      matchingBones.add(bone);
      bonesByName.set(normalizedName, matchingBones);
    });
  });

  const tracks: THREE.KeyframeTrack[] = [];
  clip.tracks.forEach((track) => {
    const separator = track.name.lastIndexOf('.');
    const targetName = track.name.slice(0, separator);
    const propertyName = track.name.slice(separator + 1);
    const normalizedName = normalizeMixamoBoneName(targetName);
    const matchingBones = bonesByName.get(normalizedName);
    if (separator <= 0 || !matchingBones?.size) {
      if (!requireEveryTrack) return;
      throw new Error(`Animation track "${track.name}" has no matching target bone.`);
    }
    let sourceTrack = track;
    if (normalizedName === 'mixamorigHips' && propertyName === 'position') {
      if (!preserveRootVerticalTranslation) return;
      sourceTrack = track.clone();
      const values = sourceTrack.values;
      const valueSize = sourceTrack.getValueSize();
      const rootX = values[0];
      const rootZ = values[2];
      for (let index = 0; index < values.length; index += valueSize) {
        values[index] = rootX;
        values[index + 2] = rootZ;
      }
    } else if (
      normalizedName === 'mixamorigHips'
      && propertyName === 'quaternion'
      && !preserveRootRotation
    ) return;

    matchingBones.forEach((bone) => {
      const retargetedTrack = sourceTrack.clone();
      retargetedTrack.name = `${bone.uuid}${track.name.slice(separator)}`;
      tracks.push(retargetedTrack);
    });
  });
  if (tracks.length === 0) {
    throw new Error(`Animation clip "${clip.name}" has no tracks matching the target skeleton.`);
  }
  return new THREE.AnimationClip(clip.name, clip.duration, tracks, clip.blendMode);
}

function normalizeMixamoBoneName(name: string): string {
  return name.replace(/^mixamorig\d*[_:]?/i, 'mixamorig');
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
  private readonly playerRoot = new THREE.Group();
  private readonly worldAimMarkerMaterial = new THREE.MeshBasicMaterial({
    color: 0xffffff,
    depthWrite: false,
    toneMapped: false,
  });
  private readonly worldAimMarker: THREE.Mesh;
  private readonly playerProjectiles: PlayerProjectile[] = [];
  private readonly hud: HTMLElement;
  private readonly crosshair: HTMLDivElement;
  private readonly touchControls: HTMLElement;
  private readonly attackStatus: HTMLElement;
  private readonly spawnProtectionMessage: HTMLElement;
  private readonly deathScreen: HTMLElement;
  private readonly selectedWeaponIndicator: HTMLElement;
  private readonly playerHealthElements: {
    label: HTMLElement;
    track: HTMLElement;
    fill: HTMLElement;
  };
  private readonly touchPointerButtons = new Map<number, HTMLButtonElement>();
  private readonly mobHealthRows = new Map<string, {
    card: HTMLElement;
    fill: HTMLElement;
    label: HTMLElement;
  }>();
  private readonly hostileMobs: HostileMob[] = [];
  private readonly keys = new Set<string>();
  private readonly touchKeys = new Set<string>();
  private readonly touchSprintKeys = new Set<string>();
  private readonly lastTouchDirectionTap = new Map<string, number>();
  private readonly velocity = new THREE.Vector3();
  private readonly knockbackVelocity = new THREE.Vector3();
  private readonly playerPosition = new THREE.Vector3(0, 0, 5);
  private readonly hitDirection = new THREE.Vector3();
  private readonly movementDirection = new THREE.Vector3();
  private readonly playerRight = new THREE.Vector3();
  private readonly deathCameraPosition = new THREE.Vector3();
  private readonly deathCameraLookTarget = new THREE.Vector3();
  private readonly cameraFollowPosition = new THREE.Vector3();
  private readonly cameraLookTarget = new THREE.Vector3();
  private readonly cameraOffset = new THREE.Vector3();
  private readonly aimOrigin = new THREE.Vector3();
  private readonly aimDirection = new THREE.Vector3();
  private readonly aimPoint = new THREE.Vector3();
  private readonly cameraOrientation = new THREE.PerspectiveCamera();
  private readonly cameraTransitionStart = new THREE.Quaternion();
  private readonly lookSensitivity: number;
  private readonly playerAnimationActions = new Map<PlayerAnimation, THREE.AnimationAction>();
  private readonly sharedPlayerAnimationClips = new Map<PlayerAnimation, THREE.AnimationClip>();
  private playerCharacter: THREE.Group | undefined;
  private playerMixer: THREE.AnimationMixer | undefined;
  private activePlayerAction: THREE.AnimationAction | undefined;
  private playerAnimationState: PlayerAnimationState = 'stopped';
  private locomotionAnimationState: PlayerAnimation = 'idle';
  private cameraView: CameraView = 'floating';
  private cameraInitialized = false;
  private cameraTransitionElapsed = CAMERA_MODE_TRANSITION_DURATION;
  private jumpHeld = false;
  private verticalVelocity = 0;
  private turnAnimationRemaining = 0;
  private crouchTransitionRemaining = 0;
  private crouchTransitionAnimation: 'crouchDown' | 'crouchUp' | undefined;
  private attackAnimationRemaining = 0;
  private wasCrouching = false;
  private airborne = false;
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

  constructor(
    container: HTMLElement,
    map: ArenaMap,
    lookSensitivity = 1,
    private readonly mobsEnabled = true,
  ) {
    this.lookSensitivity = lookSensitivity;
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'game-canvas';
    container.appendChild(this.canvas);
    const hudElements = this.createHud(container);
    this.hud = hudElements.hud;
    this.crosshair = hudElements.crosshair;
    this.attackStatus = hudElements.attackStatus;
    this.spawnProtectionMessage = hudElements.spawnProtectionMessage;
    this.deathScreen = hudElements.deathScreen;
    this.selectedWeaponIndicator = hudElements.selectedWeaponIndicator;
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
    this.cameraOrientation.rotation.order = 'YXZ';
    this.worldAimMarker = new THREE.Mesh(
      new THREE.SphereGeometry(0.035, 8, 8),
      this.worldAimMarkerMaterial,
    );
    this.worldAimMarker.visible = false;
    this.worldAimMarker.renderOrder = 1;
    this.scene.add(this.worldAimMarker);
    this.playerRoot.position.set(this.playerPosition.x, this.player.height / 2, this.playerPosition.z);
    this.scene.add(this.playerRoot);

    buildMap(this.scene, map);
    if (this.mobsEnabled) this.spawnHostileMobs();
    if (this.mobsEnabled) void this.loadHostileMobModels();
    this.attachEvents();
    this.updateCamera(0);
    void this.loadPlayerCharacter();
    this.animate();
  }

  private async loadPlayerCharacter(): Promise<void> {
    const characterLoader = new GLTFLoader();
    characterLoader.setMeshoptDecoder(MeshoptDecoder);
    const animationLoader = new FBXLoader();
    let loadedCharacter: THREE.Group | undefined;
    let normalizedModel: THREE.Group | undefined;
    let loadedMixer: THREE.AnimationMixer | undefined;
    let characterMounted = false;
    try {
      const animationEntries = Object.entries(PLAYER_ANIMATION_URLS) as [PlayerAnimation, string][];
      const characterAsset = await characterLoader.loadAsync(PLAYER_CHARACTER_URL);
      const character = characterAsset.scene;
      loadedCharacter = character;
      if (this.disposed) {
        disposeObjectResources(character);
        loadedCharacter = undefined;
        return;
      }

      const skinnedMeshes: THREE.SkinnedMesh[] = [];
      character.traverse((object) => {
        if (object instanceof THREE.SkinnedMesh) skinnedMeshes.push(object);
      });
      if (skinnedMeshes.length === 0) {
        throw new Error('character.glb does not contain a skinned player character.');
      }
      const characterBones = new Set(skinnedMeshes.flatMap(
        (mesh) => mesh.skeleton.bones.map((bone) => normalizeMixamoBoneName(bone.name)),
      ));
      if (characterBones.size === 0) {
        throw new Error('character.glb does not contain a usable Mixamo skeleton.');
      }

      character.updateMatrixWorld(true);
      const bounds = new THREE.Box3().setFromObject(character);
      const size = bounds.getSize(new THREE.Vector3());
      const center = bounds.getCenter(new THREE.Vector3());
      if (!Number.isFinite(size.y) || size.y <= 0) {
        throw new Error('character.glb has invalid model bounds.');
      }

      const modelScale = this.player.height / size.y;
      normalizedModel = new THREE.Group();
      normalizedModel.scale.setScalar(modelScale);
      normalizedModel.rotation.y = Math.PI;
      normalizedModel.position.set(
        center.x * modelScale,
        -center.y * modelScale,
        center.z * modelScale,
      );
      normalizedModel.add(character);

      const mixer = new THREE.AnimationMixer(character);
      loadedMixer = mixer;
      this.playerCharacter = character;
      this.playerMixer = mixer;
      this.playerRoot.add(normalizedModel);
      characterMounted = true;
      loadedCharacter = undefined;
      loadedMixer = undefined;

      const animationResults = await Promise.allSettled(
        animationEntries.map(([, url]) => animationLoader.loadAsync(url)),
      );
      if (this.disposed) return;

      const sharedMobAnimations = new Set<PlayerAnimation>(Object.values(HOSTILE_MOB_ANIMATIONS));
      const loadedClips = new Map<PlayerAnimation, THREE.AnimationClip>();
      animationEntries.forEach(([animation, url], index) => {
        const result = animationResults[index];
        if (result.status === 'rejected') {
          console.warn(`Unable to load optional player animation "${url}".`, result.reason);
          return;
        }
        const clip = result.value.animations.find((candidate) => candidate.tracks.length > 0);
        if (!clip) {
          console.warn(`Animation file "${url}" contains no usable animation clip.`);
          return;
        }
        loadedClips.set(animation, clip);
        if (sharedMobAnimations.has(animation)) this.sharedPlayerAnimationClips.set(animation, clip);
      });
      this.attachHostileMobAnimations();

      const animationActions = new Map<PlayerAnimation, THREE.AnimationAction>();
      animationEntries.forEach(([animation, url]) => {
        const clip = loadedClips.get(animation);
        if (!clip) return;
        try {
          const preserveRootRotation = ![
            'strafeLeft',
            'strafeRight',
            'walkStrafeLeft',
            'walkStrafeRight',
            'turnLeft',
            'turnRight',
            'turnLeft90',
            'turnRight90',
          ].includes(animation);
          const retargetedClip = retargetClipToCharacter(
            clip,
            skinnedMeshes,
            preserveRootRotation,
            animation === 'death',
          );
          const action = mixer.clipAction(retargetedClip);
          if (
            animation === 'jump'
            || animation === 'crouchDown'
            || animation === 'crouchUp'
            || animation === 'punch'
            || animation === 'death'
            || animation.startsWith('turn')
          ) {
            action.setLoop(THREE.LoopOnce, 1);
            action.clampWhenFinished = true;
          } else {
            action.setLoop(THREE.LoopRepeat, Infinity);
          }
          if (animation === 'crouchDown' || animation === 'crouchUp') {
            action.timeScale = CROUCH_TRANSITION_SPEED;
          } else if (animation === 'punch') {
            action.timeScale = PUNCH_ANIMATION_SPEED;
          }
          animationActions.set(animation, action);
        } catch (error) {
          console.warn(`Unable to retarget optional player animation "${url}".`, error);
        }
      });

      if (animationActions.size === 0) {
        console.warn('Player character loaded without any usable animation actions.');
      }

      animationActions.forEach((action, animation) => {
        this.playerAnimationActions.set(animation, action);
      });
      const initialAnimation: PlayerAnimationState = this.gameOver
        ? 'death'
        : this.playerAnimationState === 'stopped'
          ? this.locomotionAnimationState
          : this.playerAnimationState;
      this.setPlayerAnimation(initialAnimation);
      console.info(
        `Loaded character.glb with ${characterBones.size} bones and ${this.playerAnimationActions.size} player animations.`,
      );
    } catch (error) {
      if (!characterMounted) {
        if (normalizedModel?.parent === this.playerRoot) this.playerRoot.remove(normalizedModel);
        loadedMixer?.stopAllAction();
        if (loadedCharacter && loadedMixer) loadedMixer.uncacheRoot(loadedCharacter);
        if (loadedCharacter) disposeObjectResources(loadedCharacter);
      }
      console.error(
        characterMounted
          ? 'Player character loaded, but its animations could not be loaded.'
          : 'Unable to load the Mixamo player character.',
        error,
      );
    }
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
    this.playerMixer?.stopAllAction();
    if (this.playerCharacter) this.playerMixer?.uncacheRoot(this.playerCharacter);
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
    disposeObjectResources(this.scene);
    this.scene.clear();
    this.canvas.remove();
    this.hud.remove();
    this.crosshair.remove();
    this.deathScreen.remove();
    this.touchControls.remove();
  }

  private createHud(container: HTMLElement): {
    hud: HTMLElement;
    crosshair: HTMLDivElement;
    deathScreen: HTMLElement;
    spawnProtectionMessage: HTMLElement;
    attackStatus: HTMLElement;
    selectedWeaponIndicator: HTMLElement;
    playerHealth: { label: HTMLElement; track: HTMLElement; fill: HTMLElement };
  } {
    const hud = document.createElement('aside');
    hud.className = 'game-hud';
    hud.setAttribute('aria-label', 'Game status');

    const crosshair = document.createElement('div');
    crosshair.className = 'game-crosshair';
    crosshair.setAttribute('aria-hidden', 'true');

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
    const deathMenuButton = document.createElement('button');
    deathMenuButton.className = 'death-menu-button';
    deathMenuButton.type = 'button';
    deathMenuButton.textContent = 'Main Menu';
    deathMenuButton.addEventListener('click', () => {
      this.canvas.dispatchEvent(new Event('gameexit', { bubbles: true }));
    });
    deathCard.append(deathTitle, deathPrompt, deathMenuButton);
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
    const mobileHealthRow = document.createElement('div');
    mobileHealthRow.className = 'mobile-health-row';
    mobileHealthRow.innerHTML = `
      <svg class="pixel-heart" viewBox="0 0 16 16" aria-hidden="true" shape-rendering="crispEdges">
        <path fill="#29243b" d="M2 1h4v1h4V1h4v1h1v5h-1v2h-2v2H9v2H7v-2H5V9H3V7H1V2h1z"/>
        <path fill="#f35f72" d="M2 2h4v2h2V2h4v1h1v4h-2v2H9v2H7V9H5V7H3V3H2z"/>
        <path fill="#ffb5a8" d="M3 3h2v2H3zm6 0h2v2H9z"/>
      </svg>
    `;
    mobileHealthRow.appendChild(playerHealthTrack);
    const mobileHealthLabel = document.createElement('div');
    mobileHealthLabel.className = 'mobile-health-label';
    mobileHealthLabel.textContent = 'Health';
    playerHealth.append(playerHealthLabel, mobileHealthRow, mobileHealthLabel);
    hud.appendChild(playerHealth);

    const selectedWeaponIndicator = document.createElement('div');
    selectedWeaponIndicator.className = 'mobile-selected-weapon';
    selectedWeaponIndicator.setAttribute('aria-live', 'polite');
    selectedWeaponIndicator.textContent = `Weapon: ${this.player.selectedAttack.name}`;
    hud.appendChild(selectedWeaponIndicator);

    const mobList = document.createElement('div');
    mobList.className = 'mob-health-list';
    mobList.setAttribute('aria-label', 'Hostile mob health');

    if (this.mobsEnabled) {
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
    }

    container.appendChild(hud);
    container.appendChild(crosshair);
    return {
      hud,
      crosshair,
      deathScreen,
      spawnProtectionMessage,
      attackStatus,
      selectedWeaponIndicator,
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
      <div class="touch-dpad" role="group" aria-label="Movement">
        <span class="touch-dpad-center" aria-hidden="true"></span>
        <button class="touch-button touch-up" type="button" data-hold-key="KeyW" aria-label="Move forward">⌃</button>
        <button class="touch-button touch-left" type="button" data-hold-key="KeyA" aria-label="Move left">‹</button>
        <button class="touch-button touch-down" type="button" data-hold-key="KeyS" aria-label="Move backward">⌄</button>
        <button class="touch-button touch-right" type="button" data-hold-key="KeyD" aria-label="Move right">›</button>
      </div>
      <button class="touch-button touch-view" type="button" data-camera-view aria-label="Change View">
        <svg viewBox="0 0 48 36" aria-hidden="true">
          <path d="M3 8a4 4 0 0 1 4-4h22a4 4 0 0 1 4 4v20a4 4 0 0 1-4 4H7a4 4 0 0 1-4-4zM33 13l11-7v24l-11-7" />
        </svg>
        <span>Change View</span>
      </button>
      <div class="touch-weapon">
        <span>Change Weapon</span>
        <button class="touch-button" type="button" data-weapon-swap="1" aria-label="Change Weapon">
          <svg viewBox="0 0 48 48" aria-hidden="true">
            <path d="M38 20a15 15 0 0 0-27-7l-4 5m0 0v-9m0 9h9M10 28a15 15 0 0 0 27 7l4-5m0 0v9m0-9h-9" />
          </svg>
        </button>
      </div>
      <button class="touch-button touch-attack" type="button" data-hold-action="attack" aria-label="Attack">
        <svg viewBox="0 0 48 48" aria-hidden="true">
          <path d="M24 5 43 24 24 43 5 24z" />
        </svg>
      </button>
      <div class="touch-mobility">
        <button class="touch-button" type="button" data-hold-key="Space" aria-label="Jump">
          <svg viewBox="0 0 32 32" aria-hidden="true"><path d="m6 20 10-10 10 10" /></svg>
        </button>
        <span>Jump</span>
        <button class="touch-button" type="button" data-hold-key="ControlLeft" aria-label="Crouch">
          <svg viewBox="0 0 32 32" aria-hidden="true"><path d="m6 12 10 10 10-10" /></svg>
        </button>
        <span>Crouch</span>
      </div>
    `;
    controls.addEventListener('pointerdown', this.onTouchPointerDown);
    controls.addEventListener('pointerup', this.onTouchPointerEnd);
    controls.addEventListener('pointercancel', this.onTouchPointerEnd);
    controls.addEventListener('lostpointercapture', this.onTouchPointerEnd);
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

  private async loadHostileMobModels(): Promise<void> {
    const dracoLoader = new DRACOLoader();
    dracoLoader.setDecoderPath(new URL('./', document.baseURI).href);
    const loader = new GLTFLoader();
    loader.setMeshoptDecoder(MeshoptDecoder);
    loader.setDRACOLoader(dracoLoader);
    await Promise.all(Object.entries(HOSTILE_MOB_MODEL_URLS).map(async ([id, url]) => {
      if (!url) return;
      let loadedScene: THREE.Group | undefined;
      try {
        const asset = await loader.loadAsync(url);
        loadedScene = asset.scene;
        if (this.disposed) {
          disposeObjectResources(loadedScene);
          loadedScene = undefined;
          return;
        }
        const mob = this.hostileMobs.find((candidate) => candidate.definition.id === id);
        if (!mob || mob.isDefeated) {
          disposeObjectResources(loadedScene);
          loadedScene = undefined;
          if (!mob) throw new Error(`No spawned hostile mob matches model "${id}".`);
          return;
        }
        mob.setVisualModel(loadedScene);
        this.attachHostileMobAnimations();
        loadedScene = undefined;
      } catch (error) {
        if (loadedScene) disposeObjectResources(loadedScene);
        this.hostileMobs
          .find((candidate) => candidate.definition.id === id)
          ?.showCollisionProxy();
        console.error(`Unable to load the ${id} hostile mob model.`, error);
      }
    }));
  }

  private attachHostileMobAnimations(): void {
    if (this.sharedPlayerAnimationClips.size === 0) return;

    for (const mob of this.hostileMobs) {
      const skinnedMeshes: THREE.SkinnedMesh[] = [];
      mob.visualModel?.traverse((object) => {
        if (object instanceof THREE.SkinnedMesh) skinnedMeshes.push(object);
      });
      if (skinnedMeshes.length === 0) continue;

      const clips: Partial<Record<keyof typeof HOSTILE_MOB_ANIMATIONS, THREE.AnimationClip>> = {};
      for (const [state, animation] of Object.entries(HOSTILE_MOB_ANIMATIONS) as [
        keyof typeof HOSTILE_MOB_ANIMATIONS,
        PlayerAnimation,
      ][]) {
        const sourceClip = this.sharedPlayerAnimationClips.get(animation);
        if (!sourceClip) continue;
        try {
          clips[state] = retargetClipToCharacter(
            sourceClip,
            skinnedMeshes,
            true,
            false,
            false,
          );
        } catch (error) {
          console.warn(`Unable to retarget the ${animation} animation to ${mob.definition.name}.`, error);
        }
      }
      mob.setAnimationClips(clips);
    }
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
    for (let pass = 0; pass < 3; pass += 1) {
      for (let index = 0; index < this.hostileMobs.length; index += 1) {
        const mob = this.hostileMobs[index];
        mob.resolveCollisionWithPlayer(
          this.playerPosition,
          this.player.width,
          this.player.length,
          this.player.height,
        );
        for (let otherIndex = index + 1; otherIndex < this.hostileMobs.length; otherIndex += 1) {
          mob.resolveCollisionWith(this.hostileMobs[otherIndex]);
        }
      }
    }
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
    this.touchSprintKeys.clear();
    this.lastTouchDirectionTap.clear();
    this.touchPointerButtons.clear();
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
    if (attack.mode === 'melee') {
      this.turnAnimationRemaining = 0;
      this.attackAnimationRemaining = this.playPlayerAnimationForDuration('punch');
    }

    this.updateAimRay();
    this.raycaster.set(this.aimOrigin, this.aimDirection);
    this.raycaster.near = 0;
    this.raycaster.far = attack.attackRange;
    const direction = this.aimDirection.clone();
    if (attack.mode === 'melee') {
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
    mesh.position.copy(this.aimOrigin).addScaledVector(direction, 0.45);
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

  private updateCrosshairTarget(): void {
    if (this.gameOver) {
      this.crosshair.classList.remove('is-targeted');
      this.worldAimMarker.visible = false;
      return;
    }

    this.updateAimRay();
    this.raycaster.far = this.player.selectedAttack.attackRange;
    const targets = this.hostileMobs
      .filter((mob) => !mob.isDefeated)
      .map((mob) => {
        mob.mesh.updateMatrixWorld(true);
        return mob.mesh;
      });
    const hasTarget = this.raycaster.intersectObjects(targets, false).length > 0;
    this.crosshair.classList.toggle('is-targeted', hasTarget);
    this.crosshair.classList.toggle('is-floating-view', this.cameraView === 'floating');
    this.worldAimMarker.visible = this.cameraView === 'floating';
    if (this.worldAimMarker.visible) {
      this.worldAimMarker.position.copy(this.aimPoint);
      this.worldAimMarkerMaterial.color.set(hasTarget ? 0xa6ffca : 0xffffff);
    }
  }

  private updateAimRay(): void {
    this.camera.updateMatrixWorld(true);
    this.camera.getWorldDirection(this.aimDirection).normalize();
    this.aimOrigin.copy(this.camera.position);
    this.aimPoint.copy(this.aimOrigin).addScaledVector(this.aimDirection, WORLD_AIM_POINT_DISTANCE);
    this.raycaster.set(this.aimOrigin, this.aimDirection);
    this.raycaster.near = 0;
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
    event.stopPropagation();
    if (this.gameOver) return;
    if (this.paused) this.startGame();
    this.touchPointerButtons.set(event.pointerId, button);
    button.setPointerCapture(event.pointerId);

    const holdKey = button.dataset.holdKey;
    if (holdKey) {
      button.dataset.pressed = 'true';
      button.classList.add('is-pressed');
      this.touchKeys.add(holdKey);
      if (['KeyW', 'KeyA', 'KeyS', 'KeyD'].includes(holdKey)) {
        const now = performance.now();
        const previousTap = this.lastTouchDirectionTap.get(holdKey);
        if (previousTap !== undefined && now - previousTap <= TOUCH_DOUBLE_TAP_INTERVAL) {
          this.touchSprintKeys.add(holdKey);
          this.lastTouchDirectionTap.delete(holdKey);
        }
      }
      if (holdKey === 'Space') this.jumpHeld = true;
      return;
    }

    const holdAction = button.dataset.holdAction as GameAction | undefined;
    if (holdAction) {
      button.dataset.pressed = 'true';
      button.classList.add('is-pressed');
      this.emitAction(holdAction, true);
      if (holdAction === 'attack') this.performAttack();
      return;
    }

    if (button.hasAttribute('data-camera-view')) {
      this.toggleCameraView();
      return;
    }

    if (button.dataset.weaponSwap !== undefined) {
      this.changeWeapon(Number(button.dataset.weaponSwap));
    }
  };

  private onTouchPointerEnd = (event: PointerEvent): void => {
    const button = this.touchPointerButtons.get(event.pointerId);
    if (!button) return;
    this.releaseTouchButton(button, event.pointerId);
  };

  private onAnyTouchPointerEnd = (event: PointerEvent): void => {
    const button = this.touchPointerButtons.get(event.pointerId);
    if (button) this.releaseTouchButton(button, event.pointerId);
  };

  private releaseTouchButton(button: HTMLButtonElement, pointerId: number): void {
    this.touchPointerButtons.delete(pointerId);
    const stillPressed = [...this.touchPointerButtons.values()].includes(button);
    if (stillPressed || button.dataset.pressed !== 'true') return;
    delete button.dataset.pressed;
    button.classList.remove('is-pressed');

    const holdKey = button.dataset.holdKey;
    if (holdKey) {
      const anotherPointerHoldingKey = [...this.touchPointerButtons.values()]
        .some((pressedButton) => pressedButton.dataset.holdKey === holdKey);
      if (!anotherPointerHoldingKey) {
        this.touchKeys.delete(holdKey);
        if (['KeyW', 'KeyA', 'KeyS', 'KeyD'].includes(holdKey)) {
          this.touchSprintKeys.delete(holdKey);
          this.lastTouchDirectionTap.set(holdKey, performance.now());
        }
      }
      if (holdKey === 'Space') this.jumpHeld = this.isKeyDown('Space');
    }

    const holdAction = button.dataset.holdAction as GameAction | undefined;
    if (holdAction) this.emitAction(holdAction, false);
  }

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
    this.selectedWeaponIndicator.textContent = `Weapon: ${this.player.selectedAttack.name}`;
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

  private isSprinting(): boolean {
    return this.isKeyDown('ShiftLeft')
      || this.isKeyDown('ShiftRight')
      || [...this.touchSprintKeys].some((code) => this.isKeyDown(code));
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
      this.playerRoot.visible = true;
      this.deathScreen.hidden = false;
      this.turnAnimationRemaining = 0;
      this.setPlayerAnimation('death');
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
    this.cameraTransitionStart.copy(this.camera.quaternion);
    this.cameraTransitionElapsed = 0;
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
      true,
    );
    this.lastTouchLookX = event.clientX;
    this.lastTouchLookY = event.clientY;
  };

  private onCanvasPointerEnd = (event: PointerEvent): void => {
    if (event.pointerId === this.touchLookPointerId) this.touchLookPointerId = undefined;
  };

  private updateLook(movementX: number, movementY: number, touch = false): void {
    const sensitivity = 0.0022 * this.lookSensitivity
      * (touch ? TOUCH_LOOK_SENSITIVITY_MULTIPLIER : 1);
    const yawChange = -movementX * sensitivity;
    this.yaw += yawChange;
    this.pitch = THREE.MathUtils.clamp(
      this.pitch - movementY * sensitivity,
      -1.48,
      1.48,
    );
    this.requestTurnAnimation(yawChange);
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
    const sprinting = !crouching && this.isSprinting();
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

    const groundedBeforeUpdate = this.playerPosition.y <= 0;
    if (this.jumpHeld && groundedBeforeUpdate && !crouching) this.verticalVelocity = JUMP_SPEED;
    this.verticalVelocity -= GRAVITY * delta;
    this.playerPosition.y += this.verticalVelocity * delta;
    if (this.playerPosition.y < 0) {
      this.playerPosition.y = 0;
      this.verticalVelocity = 0;
    }

    this.locomotionAnimationState = this.getLocomotionAnimation(
      forwardInput,
      strafeInput,
      sprinting,
    );
    if (this.playerPosition.y <= 0 && crouching !== this.wasCrouching) {
      this.wasCrouching = crouching;
      this.crouchTransitionAnimation = crouching ? 'crouchDown' : 'crouchUp';
      this.crouchTransitionRemaining = this.playPlayerAnimationForDuration(
        this.crouchTransitionAnimation,
      );
      this.turnAnimationRemaining = 0;
    }
    this.attackAnimationRemaining = Math.max(0, this.attackAnimationRemaining - delta);
    this.crouchTransitionRemaining = Math.max(0, this.crouchTransitionRemaining - delta);
    if (this.playerPosition.y > 0) {
      this.airborne = true;
      this.turnAnimationRemaining = 0;
      this.setPlayerAnimation('jump');
    } else if (this.attackAnimationRemaining > 0) {
      this.setPlayerAnimation('punch');
    } else if (this.crouchTransitionRemaining > 0 && this.crouchTransitionAnimation) {
      this.setPlayerAnimation(this.crouchTransitionAnimation);
    } else {
      if (this.airborne) {
        this.airborne = false;
        this.turnAnimationRemaining = 0;
      }
      if (this.turnAnimationRemaining > 0) {
        this.turnAnimationRemaining = Math.max(0, this.turnAnimationRemaining - delta);
        if (this.turnAnimationRemaining === 0) {
          this.setPlayerAnimation(this.locomotionAnimationState);
        }
      } else {
        this.setPlayerAnimation(this.locomotionAnimationState);
      }
    }

    const targetHeight = crouching ? CROUCHING_HEIGHT : this.player.height;
    this.playerRoot.position.set(
      this.playerPosition.x,
      this.playerPosition.y + this.player.height / 2,
      this.playerPosition.z,
    );
    this.playerRoot.rotation.y = this.yaw;
    this.playerRoot.visible = this.cameraView === 'floating';

    if (this.cameraView === 'first-person') {
      this.cameraFollowPosition.set(
        this.playerPosition.x,
        this.playerPosition.y + targetHeight * 0.92,
        this.playerPosition.z,
      );
      this.applyCameraFollow(delta);
      this.cameraOrientation.rotation.set(this.pitch, this.yaw, this.cameraRoll);
      this.applyCameraOrientation(delta);
      return;
    }

    this.cameraLookTarget.set(
      this.playerPosition.x,
      this.playerPosition.y + targetHeight * 0.82,
      this.playerPosition.z,
    );
    const orbitPitch = THREE.MathUtils.clamp(this.pitch, -0.55, 0.55);
    this.cameraOffset.set(
      Math.sin(this.yaw) * Math.cos(orbitPitch),
      0,
      Math.cos(this.yaw) * Math.cos(orbitPitch),
    ).multiplyScalar(THIRD_PERSON_CAMERA_DISTANCE);
    this.cameraOffset.y = 0.5 - Math.sin(orbitPitch) * THIRD_PERSON_CAMERA_DISTANCE;
    this.cameraFollowPosition.copy(this.cameraLookTarget).add(this.cameraOffset);
    this.constrainThirdPersonCamera();
    this.applyCameraFollow(delta);
    this.cameraOrientation.rotation.set(this.pitch, this.yaw, this.cameraRoll);
    this.applyCameraOrientation(delta);
  }

  private applyCameraOrientation(delta: number): void {
    this.cameraOrientation.updateMatrixWorld(true);
    if (this.cameraTransitionElapsed >= CAMERA_MODE_TRANSITION_DURATION || delta <= 0) {
      this.camera.quaternion.copy(this.cameraOrientation.quaternion);
      return;
    }

    this.cameraTransitionElapsed = Math.min(
      CAMERA_MODE_TRANSITION_DURATION,
      this.cameraTransitionElapsed + delta,
    );
    const progress = this.cameraTransitionElapsed / CAMERA_MODE_TRANSITION_DURATION;
    const easedProgress = progress * progress * (3 - 2 * progress);
    this.camera.quaternion.copy(this.cameraTransitionStart)
      .slerp(this.cameraOrientation.quaternion, easedProgress);
  }

  private applyCameraFollow(delta: number): void {
    if (!this.cameraInitialized || delta <= 0) {
      this.camera.position.copy(this.cameraFollowPosition);
      this.cameraInitialized = true;
      return;
    }

    const interpolation = 1 - Math.exp(-CAMERA_FOLLOW_SMOOTHING * delta);
    this.camera.position.lerp(this.cameraFollowPosition, interpolation);
  }

  private constrainThirdPersonCamera(): void {
    this.cameraOffset.subVectors(this.cameraFollowPosition, this.cameraLookTarget);
    const distance = this.cameraOffset.length();
    if (distance <= 0) return;

    this.raycaster.set(this.cameraLookTarget, this.cameraOffset.multiplyScalar(1 / distance));
    this.raycaster.near = 0.15;
    this.raycaster.far = distance;
    const obstruction = this.raycaster.intersectObjects(this.scene.children, true).find((hit) => {
      let object: THREE.Object3D | null = hit.object;
      while (object) {
        if (object === this.playerRoot) return false;
        object = object.parent;
      }
      return hit.object instanceof THREE.Mesh;
    });

    if (obstruction) {
      const safeDistance = Math.max(0.75, obstruction.distance - 0.2);
      this.cameraFollowPosition.copy(this.cameraLookTarget)
        .addScaledVector(this.cameraOffset, safeDistance / distance);
    }
    this.cameraFollowPosition.y = Math.max(0.25, this.cameraFollowPosition.y);
  }

  private getLocomotionAnimation(
    forwardInput: number,
    strafeInput: number,
    sprinting: boolean,
  ): PlayerAnimation {
    const moving = this.velocity.lengthSq() >= 0.01;
    if (this.isCrouching()) return moving ? 'crouchedWalking' : 'crouchedIdle';
    if (!moving) return 'idle';

    const hasMovementInput = forwardInput !== 0 || strafeInput !== 0;
    const relativeForward = hasMovementInput
      ? forwardInput
      : -Math.sin(this.yaw) * this.velocity.x - Math.cos(this.yaw) * this.velocity.z;
    const relativeStrafe = hasMovementInput
      ? strafeInput
      : Math.cos(this.yaw) * this.velocity.x - Math.sin(this.yaw) * this.velocity.z;
    const movingSideways = Math.abs(relativeStrafe) > Math.abs(relativeForward);
    if (movingSideways) {
      if (relativeStrafe < 0) return sprinting ? 'strafeLeft' : 'walkStrafeLeft';
      return sprinting ? 'strafeRight' : 'walkStrafeRight';
    }
    return sprinting ? 'running' : 'walking';
  }

  private requestTurnAnimation(yawChange: number): void {
    if (
      Math.abs(yawChange) < 0.15
      || this.airborne
      || this.turnAnimationRemaining > 0
      || this.crouchTransitionRemaining > 0
      || this.attackAnimationRemaining > 0
      || this.gameOver
    ) return;

    const turningRight = yawChange < 0;
    const turnAnimation: PlayerAnimation = Math.abs(yawChange) >= 0.65
      ? turningRight ? 'turnRight90' : 'turnLeft90'
      : turningRight ? 'turnRight' : 'turnLeft';
    const action = this.playerAnimationActions.get(turnAnimation);
    if (!action) return;

    this.turnAnimationRemaining = action.getClip().duration;
    this.setPlayerAnimation(turnAnimation);
  }

  private playPlayerAnimationForDuration(animation: PlayerAnimation): number {
    const action = this.playerAnimationActions.get(animation);
    if (!action) return 0;
    this.setPlayerAnimation(animation);
    return action.getClip().duration / Math.abs(action.timeScale);
  }

  private setPlayerAnimation(state: PlayerAnimationState): void {
    const nextAction = state === 'stopped' ? undefined : this.playerAnimationActions.get(state);
    if (
      state === this.playerAnimationState
      && (state === 'stopped' || nextAction === this.activePlayerAction)
    ) return;

    this.playerAnimationState = state;
    if (!nextAction) {
      this.activePlayerAction?.fadeOut(PLAYER_ANIMATION_FADE_DURATION);
      this.activePlayerAction = undefined;
      return;
    }

    nextAction.reset().play();
    if (this.activePlayerAction && this.activePlayerAction !== nextAction) {
      this.activePlayerAction.crossFadeTo(nextAction, PLAYER_ANIMATION_FADE_DURATION);
    } else {
      nextAction.fadeIn(PLAYER_ANIMATION_FADE_DURATION);
    }
    this.activePlayerAction = nextAction;
  }

  private updateDeathCinematic(delta: number): void {
    this.deathElapsed += delta;
    const progress = Math.min(this.deathElapsed / DEATH_CINEMATIC_DURATION, 1);
    const easedProgress = progress * progress * (3 - 2 * progress);
    const angle = this.yaw + this.deathElapsed * DEATH_CAMERA_ORBIT_SPEED;
    const distance = THREE.MathUtils.lerp(
      DEATH_CAMERA_START_DISTANCE,
      DEATH_CAMERA_END_DISTANCE,
      easedProgress,
    );
    const height = THREE.MathUtils.lerp(
      DEATH_CAMERA_START_HEIGHT,
      DEATH_CAMERA_END_HEIGHT,
      easedProgress,
    ) + Math.sin(this.deathElapsed * 0.6) * 0.12;

    this.deathCameraPosition.set(
      this.playerPosition.x + Math.cos(angle) * distance,
      this.playerPosition.y + height,
      this.playerPosition.z + Math.sin(angle) * distance,
    );
    this.camera.position.lerp(
      this.deathCameraPosition,
      1 - Math.exp(-DEATH_CAMERA_FOLLOW_SPEED * delta),
    );
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
    this.updateCrosshairTarget();
    this.playerMixer?.update(delta);
    this.renderer.render(this.scene, this.camera);
    this.animationFrame = requestAnimationFrame(this.animate);
  };
}
