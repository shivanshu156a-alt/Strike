import * as THREE from 'three';
import { ARENA_GRID_SIZE, GRID_UNIT_SIZE } from './maps';
import { TEST_SHOOTER_WEAPON } from './player';

export interface HostileMobDefinition {
  id: string;
  name: string;
  movement:
    | 'approaches-player'
    | 'flies-and-approaches'
    | 'random-teleport'
    | 'roams-and-holds-range'
    | 'roams-and-teleports'
    | 'unspecified';
  movementSpeed:
    | { type: 'fixed'; blocksPerSecond: number }
    | { type: 'variable'; maximumBlocksPerSecondExclusive: number };
  dimensions: {
    length: number;
    width: number;
    height: number;
  };
  size?: 'small';
  attack: 'hand-to-hand' | 'projectile' | 'stinging' | 'unspecified';
  attackRange: 'close' | 'long' | 'unspecified';
  healthPoints: number;
  damagePerAttack: number;
  behavior: readonly string[];
  activationRadiusBlocks?: number;
  attackModeLocksOnActivation?: true;
  attackAccuracyPercent?: number;
  teleport?: {
    rangeBlocks: number;
    triggeredByPlayerAttack: true;
    blockedWhenPlayerHitIntervalUnderSeconds: number;
  };
  defeatedByAnyPlayerAttack?: true;
  projectile?: {
    speed?: 'normal';
    dodgeable?: true;
    defendableWithPerfectTiming?: true;
  };
  evasion?: 'speed' | 'flight';
  description: string;
}

export const HOSTILE_MOBS: readonly HostileMobDefinition[] = [
  {
    id: 'normal-melee-attacker',
    name: 'Normal Melee Attacker',
    movement: 'approaches-player',
    movementSpeed: { type: 'fixed', blocksPerSecond: 4.3 },
    dimensions: { length: 0.66, width: 0.66, height: 1.74 },
    attack: 'hand-to-hand',
    attackRange: 'close',
    healthPoints: 100,
    damagePerAttack: 20,
    behavior: [
      'Immediately moves toward the player.',
      'Telegraphs a close-range melee attack that can be dodged before impact.',
    ],
    description: 'Immediately approaches the player and attacks in close-range melee.',
  },
  {
    id: 'shooter',
    name: 'Shooter',
    movement: 'roams-and-holds-range',
    movementSpeed: { type: 'fixed', blocksPerSecond: 3 },
    dimensions: { length: 0.66, width: 0.66, height: 1.9 },
    attack: 'projectile',
    attackRange: 'long',
    healthPoints: 75,
    damagePerAttack: 25,
    behavior: [
      'Roams idly until the player comes within 5 blocks.',
      'Locks into attack mode once the player enters the 5-block radius.',
      'Maintains distance with short lateral strafes and fires at the player; does not chase or use melee attacks.',
    ],
    activationRadiusBlocks: 5,
    attackModeLocksOnActivation: true,
    attackAccuracyPercent: 70,
    projectile: {
      speed: 'normal',
      dodgeable: true,
      defendableWithPerfectTiming: true,
    },
    description: 'Roams until the player enters a 5-block radius, then strafes to hold distance and fires with 70% accuracy.',
  },
  {
    id: 'annoying-mob',
    name: 'Annoying Mob',
    movement: 'approaches-player',
    movementSpeed: { type: 'fixed', blocksPerSecond: 5 },
    dimensions: { length: 0.432, width: 0.432, height: 0.99 },
    size: 'small',
    attack: 'hand-to-hand',
    attackRange: 'close',
    healthPoints: 10,
    damagePerAttack: 5,
    behavior: [
      'Runs quickly toward the player.',
      'Uses a short, fast telegraph before its close-range attack.',
    ],
    defeatedByAnyPlayerAttack: true,
    evasion: 'speed',
    description: 'Runs very fast and attacks after a short telegraph; its small size and speed help it dodge player attacks.',
  },
  {
    id: 'flying-attacker',
    name: 'Flying Attacker',
    movement: 'flies-and-approaches',
    movementSpeed: { type: 'variable', maximumBlocksPerSecondExclusive: 18 },
    dimensions: { length: 1.872, width: 1.872, height: 0.4 },
    attack: 'stinging',
    attackRange: 'close',
    healthPoints: 60,
    damagePerAttack: 10,
    behavior: [
      'Roams above and around the player.',
      'Dives to player height and attacks from in front of the player.',
      'After attacking, slowly roams around the player at player height.',
      'Then rapidly flies upward and resumes roaming above the player.',
    ],
    evasion: 'flight',
    description: 'Roams above and around the player, dives to attack from the front, slowly roams at player height, then rapidly flies upward.',
  },
  {
    id: 'teleporting-ghost',
    name: 'Teleporting Ghost',
    movement: 'roams-and-teleports',
    movementSpeed: { type: 'variable', maximumBlocksPerSecondExclusive: 14 },
    dimensions: { length: 0.864, width: 0.864, height: 3.4 },
    attack: 'hand-to-hand',
    attackRange: 'close',
    healthPoints: 130,
    damagePerAttack: 20,
    behavior: [
      'Roams idly and does not attack until the player attacks it.',
      'After being attacked, enters anger mode, teleports within 10 blocks of the player, approaches, and attacks.',
      'Teleports again after attacking unless teleporting is blocked by the rapid-hit condition.',
    ],
    teleport: {
      rangeBlocks: 10,
      triggeredByPlayerAttack: true,
      blockedWhenPlayerHitIntervalUnderSeconds: 0.4,
    },
    description: 'Roams idly until attacked, then teleports near and attacks the player; rapid player hits can block teleporting.',
  },
];

export interface HostileMobHealth {
  id: string;
  name: string;
  health: number;
  maxHealth: number;
  defeated: boolean;
}

interface HostileProjectile {
  mesh: THREE.Mesh;
  velocity: THREE.Vector3;
  damage: number;
}

type FlyingAttackerState = 'roaming' | 'diving' | 'ground-roaming' | 'rising';
type HostileMobAnimation = 'idle' | 'walking' | 'running' | 'attack' | 'defeated';

const MOB_COLORS: Record<string, number> = {
  'normal-melee-attacker': 0xd95745,
  shooter: 0x5686d8,
  'annoying-mob': 0xf1c342,
  'flying-attacker': 0x54c878,
  'teleporting-ghost': 0xa66be0,
};

const PLAYER_HIT_RADIUS = 0.85;
const MELEE_ATTACK_RADIUS = 1.35;
const PROJECTILE_SPEED = 14;
const ARENA_HALF_EXTENT = ARENA_GRID_SIZE * GRID_UNIT_SIZE / 2;

export class HostileMob {
  readonly definition: HostileMobDefinition;
  readonly mesh: THREE.Mesh;
  readonly position = new THREE.Vector3();
  visualModel: THREE.Object3D | undefined;

  private readonly scene: THREE.Scene;
  private readonly projectiles: HostileProjectile[] = [];
  private readonly onPlayerDamage: (amount: number, attackDirection: THREE.Vector3) => void;
  private readonly onHealthChange: (health: HostileMobHealth) => void;
  private readonly roamTarget = new THREE.Vector3();
  private readonly retreatTarget = new THREE.Vector3();
  private readonly strafeTarget = new THREE.Vector3();
  private readonly playerHitCenter = new THREE.Vector3();
  private readonly projectileStart = new THREE.Vector3();
  private readonly projectileSegment = new THREE.Vector3();
  private readonly toPlayerFromProjectileStart = new THREE.Vector3();
  private readonly closestProjectilePoint = new THREE.Vector3();
  private readonly knockbackVelocity = new THREE.Vector3();
  private readonly knockbackDirection = new THREE.Vector3();
  private readonly attackDirection = new THREE.Vector3();
  private readonly previousPosition = new THREE.Vector3();
  private readonly animationActions = new Map<HostileMobAnimation, THREE.AnimationAction>();
  private currentHealth: number;
  private animationMixer: THREE.AnimationMixer | undefined;
  private activeAnimation: THREE.AnimationAction | undefined;
  private attackAnimationRemaining = 0;
  private attackCooldown = Math.random() * 0.8;
  private attackWindupRemaining = 0;
  private fireCooldown = 1 + Math.random() * 1.5;
  private roamTimer = 0;
  private strafeTimer = 0;
  private strafeDirection = Math.random() < 0.5 ? -1 : 1;
  private defeatKnockbackRemaining = 0;
  private elapsed = 0;
  private state: FlyingAttackerState = 'roaming';
  private attackModeLocked = false;
  private angry = false;
  private lastPlayerHitAt: number | undefined;
  private teleportBlockedUntil = 0;
  private disposed = false;

  constructor(
    definition: HostileMobDefinition,
    scene: THREE.Scene,
    position: THREE.Vector3,
    onPlayerDamage: (amount: number, attackDirection: THREE.Vector3) => void,
    onHealthChange: (health: HostileMobHealth) => void,
  ) {
    this.definition = definition;
    this.scene = scene;
    this.position.copy(position);
    this.onPlayerDamage = onPlayerDamage;
    this.onHealthChange = onHealthChange;
    this.currentHealth = definition.healthPoints;

    const geometry = new THREE.BoxGeometry(
      definition.dimensions.width,
      definition.dimensions.height,
      definition.dimensions.length,
    );
    const material = new THREE.MeshStandardMaterial({
      color: MOB_COLORS[definition.id] ?? 0xd7d7d7,
      roughness: 0.72,
      metalness: 0.05,
      transparent: true,
      opacity: 0,
      colorWrite: false,
      depthWrite: false,
    });
    this.mesh = new THREE.Mesh(geometry, material);
    this.mesh.position.copy(this.position);
    this.scene.add(this.mesh);
    this.mesh.updateMatrixWorld(true);
    this.chooseRoamTarget();
    this.emitHealth();
  }

  setVisualModel(model: THREE.Object3D): void {
    if (this.disposed) return;

    model.updateMatrixWorld(true);
    const bounds = new THREE.Box3().setFromObject(model);
    const size = bounds.getSize(new THREE.Vector3());
    const center = bounds.getCenter(new THREE.Vector3());
    if (
      !Number.isFinite(size.x)
      || !Number.isFinite(size.y)
      || !Number.isFinite(size.z)
      || size.x <= 0
      || size.y <= 0
      || size.z <= 0
    ) {
      throw new Error(`Hostile mob model "${this.definition.name}" has invalid bounds.`);
    }

    const normalizedModel = new THREE.Group();
    normalizedModel.scale.set(
      this.definition.dimensions.width / size.x,
      this.definition.dimensions.height / size.y,
      this.definition.dimensions.length / size.z,
    );
    normalizedModel.position.set(
      -center.x * normalizedModel.scale.x,
      -center.y * normalizedModel.scale.y,
      -center.z * normalizedModel.scale.z,
    );
    normalizedModel.add(model);
    normalizedModel.traverse((object) => {
      if (!(object instanceof THREE.Mesh)) return;
      object.castShadow = true;
      object.receiveShadow = true;
    });
    this.mesh.add(normalizedModel);
    this.visualModel = model;
    this.mesh.updateMatrixWorld(true);
  }

  setAnimationClips(clips: Partial<Record<HostileMobAnimation, THREE.AnimationClip>>): void {
    if (this.disposed || !this.visualModel || this.animationMixer) return;

    this.animationMixer = new THREE.AnimationMixer(this.visualModel);
    for (const [state, clip] of Object.entries(clips) as [HostileMobAnimation, THREE.AnimationClip][]) {
      const action = this.animationMixer.clipAction(clip);
      if (state === 'attack' || state === 'defeated') {
        action.setLoop(THREE.LoopOnce, 1);
        action.clampWhenFinished = state === 'defeated';
      } else {
        action.setLoop(THREE.LoopRepeat, Infinity);
      }
      this.animationActions.set(state, action);
    }
    this.setAnimation(this.isDefeated ? 'defeated' : 'idle');
    this.animationMixer.update(0);
  }

  showCollisionProxy(): void {
    const materials = Array.isArray(this.mesh.material) ? this.mesh.material : [this.mesh.material];
    materials.forEach((material) => {
      material.transparent = false;
      material.opacity = 1;
      material.colorWrite = true;
      material.depthWrite = true;
      material.needsUpdate = true;
    });
  }

  get health(): number {
    return this.currentHealth;
  }

  get isDefeated(): boolean {
    return this.currentHealth <= 0;
  }

  takeDamage(
    amount = TEST_SHOOTER_WEAPON.attackDamage,
    knockbackDirection?: THREE.Vector3,
  ): void {
    if (!Number.isFinite(amount) || amount < 0) {
      throw new RangeError('Mob damage must be a finite, non-negative number.');
    }
    if (this.isDefeated || amount === 0) return;

    this.currentHealth = this.definition.defeatedByAnyPlayerAttack
      ? 0
      : Math.max(0, this.currentHealth - amount);
    if (knockbackDirection) {
      this.knockbackDirection.copy(knockbackDirection).normalize();
      this.knockbackVelocity.addScaledVector(this.knockbackDirection, 5);
    }
    if (this.definition.id === 'teleporting-ghost') this.registerGhostHit();
    this.emitHealth();
    if (this.isDefeated) {
      this.setAnimation('defeated');
      if (knockbackDirection) this.defeatKnockbackRemaining = 0.22;
      else this.removeFromScene();
    }
  }

  update(delta: number, playerPosition: THREE.Vector3, playerYaw = 0): void {
    if (this.disposed) return;
    if (this.isDefeated) {
      this.previousPosition.copy(this.position);
      this.updateDefeatKnockback(delta);
      this.updateAnimation(delta, this.previousPosition);
      return;
    }
    this.previousPosition.copy(this.position);
    this.elapsed += delta;
    this.attackCooldown = Math.max(0, this.attackCooldown - delta);
    this.fireCooldown = Math.max(0, this.fireCooldown - delta);
    this.roamTimer -= delta;

    switch (this.definition.id) {
      case 'normal-melee-attacker':
      case 'annoying-mob':
        this.updateMeleeChaser(delta, playerPosition);
        break;
      case 'shooter':
        this.updateShooter(delta, playerPosition);
        break;
      case 'flying-attacker':
        this.updateFlyingAttacker(delta, playerPosition, playerYaw);
        break;
      case 'teleporting-ghost':
        this.updateGhost(delta, playerPosition);
        break;
      default:
        this.updateRoaming(delta, false);
    }

    this.updateProjectiles(delta, playerPosition);
    this.applyKnockback(delta);
    this.updateAnimation(delta, this.previousPosition);
  }

  resolveCollisionWithPlayer(
    playerPosition: THREE.Vector3,
    playerWidth: number,
    playerLength: number,
    playerHeight: number,
  ): void {
    if (this.disposed) return;
    const mobBottom = this.position.y - this.definition.dimensions.height / 2;
    const mobTop = this.position.y + this.definition.dimensions.height / 2;
    if (mobBottom >= playerPosition.y + playerHeight || mobTop <= playerPosition.y) return;

    const playerRadius = Math.hypot(playerWidth, playerLength) / 2;
    this.separateFrom(playerPosition.x, playerPosition.z, playerRadius);
  }

  resolveCollisionWith(other: HostileMob): void {
    if (this.disposed || other.disposed) return;
    const combinedHalfHeight = (
      this.definition.dimensions.height + other.definition.dimensions.height
    ) / 2;
    if (Math.abs(this.position.y - other.position.y) >= combinedHalfHeight) return;

    const ownRadius = Math.hypot(
      this.definition.dimensions.width,
      this.definition.dimensions.length,
    ) / 2;
    const otherRadius = Math.hypot(
      other.definition.dimensions.width,
      other.definition.dimensions.length,
    ) / 2;
    const directionX = this.position.x - other.position.x;
    const directionZ = this.position.z - other.position.z;
    const distance = Math.hypot(directionX, directionZ);
    const overlap = ownRadius + otherRadius - distance;
    if (overlap <= 0) return;

    const normalX = distance > 0.001 ? directionX / distance : 1;
    const normalZ = distance > 0.001 ? directionZ / distance : 0;
    this.position.x += normalX * overlap / 2;
    this.position.z += normalZ * overlap / 2;
    this.clampToArena();
    this.syncMeshPosition();
    other.position.x -= normalX * overlap / 2;
    other.position.z -= normalZ * overlap / 2;
    other.clampToArena();
    other.syncMeshPosition();
  }

  dispose(): void {
    this.removeFromScene();
  }

  private separateFrom(otherX: number, otherZ: number, otherRadius: number): number {
    const radius = Math.hypot(
      this.definition.dimensions.width,
      this.definition.dimensions.length,
    ) / 2;
    const directionX = this.position.x - otherX;
    const directionZ = this.position.z - otherZ;
    const distance = Math.hypot(directionX, directionZ);
    const overlap = radius + otherRadius - distance;
    if (overlap <= 0) return 0;

    const normalX = distance > 0.001 ? directionX / distance : 1;
    const normalZ = distance > 0.001 ? directionZ / distance : 0;
    this.position.x += normalX * overlap;
    this.position.z += normalZ * overlap;
    this.clampToArena();
    this.syncMeshPosition();
    return overlap;
  }

  private clampToArena(): void {
    const horizontalRadius = Math.hypot(
      this.definition.dimensions.width,
      this.definition.dimensions.length,
    ) / 2;
    this.position.x = THREE.MathUtils.clamp(
      this.position.x,
      -ARENA_HALF_EXTENT + horizontalRadius,
      ARENA_HALF_EXTENT - horizontalRadius,
    );
    this.position.z = THREE.MathUtils.clamp(
      this.position.z,
      -ARENA_HALF_EXTENT + horizontalRadius,
      ARENA_HALF_EXTENT - horizontalRadius,
    );
  }

  private syncMeshPosition(): void {
    this.mesh.position.copy(this.position);
    this.mesh.updateMatrixWorld(true);
  }

  private playAttackAnimation(): void {
    this.attackAnimationRemaining = 0.65;
    this.setAnimation('attack');
  }

  private updateAnimation(delta: number, previousPosition: THREE.Vector3): void {
    if (!this.animationMixer) return;
    if (this.isDefeated) {
      this.setAnimation('defeated');
    } else {
      this.attackAnimationRemaining = Math.max(0, this.attackAnimationRemaining - delta);
      if (this.attackAnimationRemaining > 0) {
        this.setAnimation('attack');
      } else if (this.position.distanceToSquared(previousPosition) > 0.0001) {
        const maximumSpeed = this.definition.movementSpeed.type === 'fixed'
          ? this.definition.movementSpeed.blocksPerSecond
          : this.definition.movementSpeed.maximumBlocksPerSecondExclusive;
        this.setAnimation(maximumSpeed > 4 ? 'running' : 'walking');
      } else {
        this.setAnimation('idle');
      }
    }
    this.animationMixer.update(delta);
  }

  private setAnimation(state: HostileMobAnimation): void {
    const nextAction = this.animationActions.get(state);
    if (!nextAction || nextAction === this.activeAnimation) return;

    nextAction.reset().play();
    if (this.activeAnimation) {
      this.activeAnimation.crossFadeTo(nextAction, 0.15);
    } else {
      nextAction.fadeIn(0.15);
    }
    this.activeAnimation = nextAction;
  }

  private updateDefeatKnockback(delta: number): void {
    if (this.defeatKnockbackRemaining <= 0) {
      this.removeFromScene();
      return;
    }

    this.defeatKnockbackRemaining -= delta;
    this.applyKnockback(delta);
    if (this.defeatKnockbackRemaining <= 0) this.removeFromScene();
  }

  private applyKnockback(delta: number): void {
    this.position.addScaledVector(this.knockbackVelocity, delta);
    this.knockbackVelocity.multiplyScalar(Math.exp(-5 * delta));
    const horizontalRadius = Math.hypot(
      this.definition.dimensions.width,
      this.definition.dimensions.length,
    ) / 2;
    this.position.x = THREE.MathUtils.clamp(
      this.position.x,
      -ARENA_HALF_EXTENT + horizontalRadius,
      ARENA_HALF_EXTENT - horizontalRadius,
    );
    this.position.z = THREE.MathUtils.clamp(
      this.position.z,
      -ARENA_HALF_EXTENT + horizontalRadius,
      ARENA_HALF_EXTENT - horizontalRadius,
    );
    this.mesh.position.copy(this.position);
    this.mesh.updateMatrixWorld(true);
  }

  private updateMeleeChaser(delta: number, playerPosition: THREE.Vector3): void {
    const distance = this.horizontalDistanceTo(playerPosition);
    if (distance > MELEE_ATTACK_RADIUS) {
      this.cancelMeleeWindup();
      const target = playerPosition.clone();
      target.y = this.definition.dimensions.height / 2;
      this.moveToward(delta, target, this.fixedSpeed());
      return;
    }

    this.face(playerPosition);
    if (this.attackWindupRemaining > 0) {
      this.attackWindupRemaining = Math.max(0, this.attackWindupRemaining - delta);
      if (this.attackWindupRemaining > 0) return;

      this.setAttackTelegraph(false);
      if (this.horizontalDistanceTo(playerPosition) > MELEE_ATTACK_RADIUS) return;
      this.attackDirection.copy(playerPosition).sub(this.position).setY(0).normalize();
      this.playAttackAnimation();
      this.onPlayerDamage(this.definition.damagePerAttack, this.attackDirection);
      this.attackCooldown = this.definition.id === 'annoying-mob' ? 0.8 : 1.1;
      return;
    }

    if (this.attackCooldown === 0) {
      this.attackWindupRemaining = this.definition.id === 'annoying-mob' ? 0.18 : 0.35;
      this.setAttackTelegraph(true);
    }
  }

  private updateShooter(delta: number, playerPosition: THREE.Vector3): void {
    const distance = this.horizontalDistanceTo(playerPosition);
    const radius = this.definition.activationRadiusBlocks ?? 7;
    if (distance <= radius) this.attackModeLocked = true;
    if (!this.attackModeLocked || (this.definition.attackModeLocksOnActivation !== true && distance > radius)) {
      this.updateRoaming(delta, false);
      return;
    }

    const preferredDistance = 5.5;
    if (distance < preferredDistance) {
      if (distance < 4.5) {
        const retreat = this.position.clone().sub(playerPosition);
        retreat.y = 0;
        if (retreat.lengthSq() < 0.001) retreat.set(1, 0, 0);
        retreat.normalize().multiplyScalar(8);
        this.strafeTarget.copy(playerPosition).add(retreat);
        this.strafeTarget.y = this.position.y;
        this.moveToward(delta, this.strafeTarget, this.fixedSpeed());
      } else {
        this.strafeTimer -= delta;
        if (this.strafeTimer <= 0 || this.position.distanceTo(this.strafeTarget) < 0.5) {
          this.strafeDirection *= -1;
          const toPlayerX = playerPosition.x - this.position.x;
          const toPlayerZ = playerPosition.z - this.position.z;
          this.strafeTarget.set(
            this.position.x - toPlayerZ * this.strafeDirection,
            this.position.y,
            this.position.z + toPlayerX * this.strafeDirection,
          );
          this.strafeTarget.sub(this.position).setLength(2.5).add(this.position);
          this.strafeTimer = 0.9 + Math.random() * 0.8;
        }
        this.moveToward(delta, this.strafeTarget, this.fixedSpeed());
      }
    }

    this.face(playerPosition);
    if (this.fireCooldown === 0) {
      this.playAttackAnimation();
      this.fireAt(playerPosition, this.definition.attackAccuracyPercent ?? 70);
      this.fireCooldown = 1.6 + Math.random() * 0.5;
    }
  }

  private updateFlyingAttacker(
    delta: number,
    playerPosition: THREE.Vector3,
    playerYaw: number,
  ): void {
    if (this.state === 'roaming') {
      if (this.roamTimer <= 0 || this.position.distanceTo(this.roamTarget) < 1) {
        const angle = Math.random() * Math.PI * 2;
        const radius = 4 + Math.random() * 4;
        this.roamTarget.set(
          playerPosition.x + Math.cos(angle) * radius,
          playerPosition.y + 4.5 + Math.random() * 2,
          playerPosition.z + Math.sin(angle) * radius,
        );
        this.roamTimer = 1.5 + Math.random() * 1.2;
      }
      this.moveToward(delta, this.roamTarget, 5);
      if (this.attackCooldown === 0) this.state = 'diving';
      return;
    }

    if (this.state === 'diving') {
      const playerForward = new THREE.Vector3(-Math.sin(playerYaw), 0, -Math.cos(playerYaw));
      const target = playerPosition.clone().addScaledVector(playerForward, 0.85);
      target.y += 0.9;
      this.moveToward(delta, target, 9);
      if (this.position.distanceTo(target) <= MELEE_ATTACK_RADIUS) {
        this.attackDirection.copy(playerPosition).sub(this.position).normalize();
        this.playAttackAnimation();
        this.onPlayerDamage(this.definition.damagePerAttack, this.attackDirection);
        this.state = 'ground-roaming';
        this.roamTimer = 2 + Math.random() * 1.2;
        this.chooseGroundRoamTarget(playerPosition);
      }
      return;
    }

    if (this.state === 'ground-roaming') {
      if (this.roamTimer <= 0) {
        this.state = 'rising';
        this.retreatTarget.set(this.position.x, playerPosition.y + 7, this.position.z);
        return;
      }
      if (this.position.distanceTo(this.roamTarget) < 0.5) {
        this.chooseGroundRoamTarget(playerPosition);
      }
      this.moveToward(delta, this.roamTarget, 2.5);
      this.position.y = playerPosition.y + 0.9;
      return;
    }

    this.moveToward(delta, this.retreatTarget, 16);
    if (this.position.y >= playerPosition.y + 6.5) {
      this.state = 'roaming';
      this.roamTimer = 0;
      this.attackCooldown = 1.5 + Math.random() * 1.5;
    }
  }

  private chooseGroundRoamTarget(playerPosition: THREE.Vector3): void {
    const angle = Math.random() * Math.PI * 2;
    const radius = 2.5 + Math.random() * 2.5;
    this.roamTarget.set(
      playerPosition.x + Math.cos(angle) * radius,
      playerPosition.y + 0.9,
      playerPosition.z + Math.sin(angle) * radius,
    );
  }

  private updateGhost(delta: number, playerPosition: THREE.Vector3): void {
    if (!this.angry) {
      this.updateRoaming(delta, false);
      return;
    }

    if (this.roamTimer <= 0) this.attemptGhostTeleport(playerPosition);
    if (this.horizontalDistanceTo(playerPosition) > MELEE_ATTACK_RADIUS) {
      const target = playerPosition.clone();
      target.y = this.definition.dimensions.height / 2;
      this.moveToward(delta, target, this.variableSpeed(7, 13));
      return;
    }

    this.face(playerPosition);
    if (this.attackCooldown === 0) {
      this.attackDirection.copy(playerPosition).sub(this.position).setY(0).normalize();
      this.playAttackAnimation();
      this.onPlayerDamage(this.definition.damagePerAttack, this.attackDirection);
      this.attackCooldown = 1.6;
      this.attemptGhostTeleport(playerPosition);
    }
  }

  private updateRoaming(delta: number, flying: boolean): void {
    if (this.roamTimer <= 0 || this.position.distanceTo(this.roamTarget) < 0.6) {
      const halfExtent = 44;
      this.roamTarget.set(
        THREE.MathUtils.randFloat(-halfExtent, halfExtent),
        flying ? 5 + Math.random() * 5 : this.definition.dimensions.height / 2,
        THREE.MathUtils.randFloat(-halfExtent, halfExtent),
      );
      this.roamTimer = 2 + Math.random() * 3;
    }
    this.moveToward(delta, this.roamTarget, flying ? this.variableSpeed(7, 13) : this.fixedSpeed());
  }

  private moveToward(delta: number, target: THREE.Vector3, speed: number): void {
    const direction = target.clone().sub(this.position);
    const distance = direction.length();
    if (distance < 0.001) return;
    direction.multiplyScalar(1 / distance);
    const step = Math.min(distance, speed * delta);
    this.position.addScaledVector(direction, step);
    const horizontalRadius = Math.hypot(
      this.definition.dimensions.width,
      this.definition.dimensions.length,
    ) / 2;
    const minBound = -ARENA_HALF_EXTENT + horizontalRadius;
    const maxBound = ARENA_HALF_EXTENT - horizontalRadius;
    this.position.x = THREE.MathUtils.clamp(this.position.x, minBound, maxBound);
    this.position.z = THREE.MathUtils.clamp(this.position.z, minBound, maxBound);
    this.mesh.position.copy(this.position);
    this.mesh.updateMatrixWorld(true);
    this.face(target);
  }

  private fireAt(playerPosition: THREE.Vector3, accuracyPercent: number): void {
    const origin = this.position.clone();
    const target = playerPosition.clone();
    target.y += 0.8;
    if (Math.random() * 100 >= accuracyPercent) {
      const missDistance = THREE.MathUtils.randFloat(3.2, 4.5);
      const horizontalDirection = new THREE.Vector3(
        playerPosition.x - origin.x,
        0,
        playerPosition.z - origin.z,
      );
      if (horizontalDirection.lengthSq() < 0.001) horizontalDirection.set(1, 0, 0);
      horizontalDirection.normalize();
      target.x -= horizontalDirection.z * missDistance;
      target.y += THREE.MathUtils.randFloat(-1.5, 1.5);
      target.z += horizontalDirection.x * missDistance;
    }

    const direction = target.sub(origin).normalize();
    const geometry = new THREE.SphereGeometry(0.12, 8, 8);
    const material = new THREE.MeshBasicMaterial({
      color: MOB_COLORS[this.definition.id] ?? 0xffffff,
    });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.copy(origin);
    this.scene.add(mesh);
    this.projectiles.push({
      mesh,
      velocity: direction.multiplyScalar(PROJECTILE_SPEED),
      damage: this.definition.damagePerAttack,
    });
  }

  private updateProjectiles(delta: number, playerPosition: THREE.Vector3): void {
    this.playerHitCenter.copy(playerPosition);
    this.playerHitCenter.y += 0.8;

    for (let index = this.projectiles.length - 1; index >= 0; index -= 1) {
      const projectile = this.projectiles[index];
      this.projectileStart.copy(projectile.mesh.position);
      this.projectileSegment.copy(projectile.velocity).multiplyScalar(delta);
      const segmentLengthSquared = this.projectileSegment.lengthSq();
      const projection = segmentLengthSquared === 0
        ? 0
        : THREE.MathUtils.clamp(
          this.toPlayerFromProjectileStart.copy(this.playerHitCenter)
            .sub(this.projectileStart)
            .dot(this.projectileSegment) / segmentLengthSquared,
          0,
          1,
        );
      this.closestProjectilePoint.copy(this.projectileStart)
        .addScaledVector(this.projectileSegment, projection);

      if (this.closestProjectilePoint.distanceToSquared(this.playerHitCenter) <= PLAYER_HIT_RADIUS ** 2) {
        this.onPlayerDamage(projectile.damage, projectile.velocity);
        this.removeProjectile(index);
        continue;
      }
      projectile.mesh.position.add(this.projectileSegment);
      if (
        Math.abs(projectile.mesh.position.x) > 50
        || Math.abs(projectile.mesh.position.z) > 50
        || projectile.mesh.position.y < -1
        || projectile.mesh.position.y > 30
      ) {
        this.removeProjectile(index);
      }
    }
  }

  private registerGhostHit(): void {
    this.angry = true;
    if (
      this.lastPlayerHitAt !== undefined
      && this.elapsed - this.lastPlayerHitAt
        < (this.definition.teleport?.blockedWhenPlayerHitIntervalUnderSeconds ?? 0.4)
    ) {
      this.teleportBlockedUntil = this.elapsed
        + (this.definition.teleport?.blockedWhenPlayerHitIntervalUnderSeconds ?? 0.4);
    }
    this.lastPlayerHitAt = this.elapsed;
    this.roamTimer = 0;
  }

  private cancelMeleeWindup(): void {
    if (this.attackWindupRemaining === 0) return;
    this.attackWindupRemaining = 0;
    this.setAttackTelegraph(false);
  }

  private setAttackTelegraph(active: boolean): void {
    this.mesh.traverse((object) => {
      if (!(object instanceof THREE.Mesh)) return;
      const materials = Array.isArray(object.material) ? object.material : [object.material];
      for (const material of materials) {
        if (!(material instanceof THREE.MeshStandardMaterial)) continue;
        material.emissive.setHex(active ? 0xff4b24 : 0x000000);
        material.emissiveIntensity = active ? 0.8 : 0;
      }
    });
  }

  private attemptGhostTeleport(playerPosition: THREE.Vector3): void {
    const teleport = this.definition.teleport;
    if (!teleport || this.elapsed < this.teleportBlockedUntil) return;

    const minimumDistance = 7;
    const maximumTeleportDistance = Math.min(10, teleport.rangeBlocks);
    if (maximumTeleportDistance < minimumDistance) {
      throw new Error('Teleport range must allow a destination at least 7 units away.');
    }
    const horizontalRadius = Math.hypot(
      this.definition.dimensions.width,
      this.definition.dimensions.length,
    ) / 2;
    const minBound = -ARENA_HALF_EXTENT + horizontalRadius;
    const maxBound = ARENA_HALF_EXTENT - horizontalRadius;
    const angleOffset = Math.random() * Math.PI * 2;

    for (let index = 0; index < 32; index += 1) {
      const angle = angleOffset + index * (Math.PI * 2 / 32);
      const directionX = Math.cos(angle);
      const directionZ = Math.sin(angle);
      const xLimit = directionX > 0
        ? (maxBound - playerPosition.x) / directionX
        : directionX < 0 ? (minBound - playerPosition.x) / directionX : Number.POSITIVE_INFINITY;
      const zLimit = directionZ > 0
        ? (maxBound - playerPosition.z) / directionZ
        : directionZ < 0 ? (minBound - playerPosition.z) / directionZ : Number.POSITIVE_INFINITY;
      const maximumDistance = Math.min(maximumTeleportDistance, xLimit, zLimit);
      if (maximumDistance < minimumDistance) continue;

      const distance = THREE.MathUtils.randFloat(minimumDistance, maximumDistance);
      this.position.set(
        playerPosition.x + directionX * distance,
        this.definition.dimensions.height / 2,
        playerPosition.z + directionZ * distance,
      );
      this.mesh.position.copy(this.position);
      this.roamTimer = Number.POSITIVE_INFINITY;
      return;
    }

    this.roamTimer = 0.5;
  }

  private horizontalDistanceTo(target: THREE.Vector3): number {
    return Math.hypot(this.position.x - target.x, this.position.z - target.z);
  }

  private face(target: THREE.Vector3): void {
    const dx = target.x - this.position.x;
    const dz = target.z - this.position.z;
    if (Math.abs(dx) + Math.abs(dz) > 0.001) this.mesh.rotation.y = Math.atan2(dx, dz);
  }

  private fixedSpeed(): number {
    return this.definition.movementSpeed.type === 'fixed'
      ? this.definition.movementSpeed.blocksPerSecond
      : this.definition.movementSpeed.maximumBlocksPerSecondExclusive * 0.7;
  }

  private variableSpeed(minimum: number, maximum: number): number {
    const declaredMaximum = this.definition.movementSpeed.type === 'variable'
      ? this.definition.movementSpeed.maximumBlocksPerSecondExclusive
      : maximum;
    return THREE.MathUtils.clamp(
      THREE.MathUtils.randFloat(minimum, maximum),
      minimum,
      declaredMaximum - 0.1,
    );
  }

  private chooseRoamTarget(): void {
    const flying = this.definition.id.startsWith('flying-');
    this.roamTarget.set(
      THREE.MathUtils.randFloat(-44, 44),
      flying ? 5 + Math.random() * 5 : this.definition.dimensions.height / 2,
      THREE.MathUtils.randFloat(-44, 44),
    );
    this.roamTimer = 1 + Math.random() * 3;
  }

  private emitHealth(): void {
    this.onHealthChange({
      id: this.definition.id,
      name: this.definition.name,
      health: this.currentHealth,
      maxHealth: this.definition.healthPoints,
      defeated: this.isDefeated,
    });
  }

  private removeProjectile(index: number): void {
    const [projectile] = this.projectiles.splice(index, 1);
    this.scene.remove(projectile.mesh);
    projectile.mesh.geometry.dispose();
    const material = projectile.mesh.material;
    if (Array.isArray(material)) material.forEach((item) => item.dispose());
    else material.dispose();
  }

  private removeFromScene(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.scene.remove(this.mesh);
    this.animationMixer?.stopAllAction();
    if (this.visualModel) this.animationMixer?.uncacheRoot(this.visualModel);
    this.mesh.traverse((object) => {
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
    for (let index = this.projectiles.length - 1; index >= 0; index -= 1) {
      this.removeProjectile(index);
    }
  }
}
