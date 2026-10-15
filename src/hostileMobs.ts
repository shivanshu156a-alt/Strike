export interface HostileMobDefinition {
  id: string;
  name: string;
  movement:
    | 'approaches-player'
    | 'flies-and-approaches'
    | 'flies-at-range'
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
    dimensions: { length: 0.46, width: 0.87, height: 1.74 },
    attack: 'hand-to-hand',
    attackRange: 'close',
    healthPoints: 100,
    damagePerAttack: 20,
    behavior: [
      'Immediately moves toward the player.',
      'Attacks in close-range melee while approaching.',
    ],
    description: 'Immediately approaches the player and attacks in close-range melee.',
  },
  {
    id: 'shooter',
    name: 'Shooter',
    movement: 'roams-and-holds-range',
    movementSpeed: { type: 'fixed', blocksPerSecond: 3 },
    dimensions: { length: 0.46, width: 0.87, height: 1.9 },
    attack: 'projectile',
    attackRange: 'long',
    healthPoints: 75,
    damagePerAttack: 25,
    behavior: [
      'Roams idly while the player is outside its attack radius.',
      'Enters attack mode when the player is within 7 blocks.',
      'Maintains distance and fires; does not chase or use melee attacks.',
    ],
    activationRadiusBlocks: 7,
    attackAccuracyPercent: 70,
    projectile: {
      speed: 'normal',
      dodgeable: true,
      defendableWithPerfectTiming: true,
    },
    description: 'Roams outside a 7-block radius; inside it, keeps distance and fires with 70% accuracy.',
  },
  {
    id: 'annoying-mob',
    name: 'Annoying Mob',
    movement: 'approaches-player',
    movementSpeed: { type: 'fixed', blocksPerSecond: 5 },
    dimensions: { length: 0.3, width: 0.7, height: 0.99 },
    size: 'small',
    attack: 'hand-to-hand',
    attackRange: 'close',
    healthPoints: 10,
    damagePerAttack: 5,
    behavior: ['Runs quickly toward the player and attacks in close-range melee.'],
    defeatedByAnyPlayerAttack: true,
    evasion: 'speed',
    description: 'Runs very fast to approach and attack at close range; its small size and speed help it dodge player attacks.',
  },
  {
    id: 'flying-attacker',
    name: 'Flying Attacker',
    movement: 'flies-and-approaches',
    movementSpeed: { type: 'variable', maximumBlocksPerSecondExclusive: 20 },
    dimensions: { length: 1.3, width: 0.4, height: 0.67 },
    attack: 'stinging',
    attackRange: 'close',
    healthPoints: 60,
    damagePerAttack: 10,
    behavior: [
      'Roams above the player.',
      'Dives quickly toward the player and attacks, damaging them.',
      'Flies away after attacking.',
    ],
    evasion: 'flight',
    description: 'Roams above the player, dives to attack, then flies away.',
  },
  {
    id: 'flying-shooter',
    name: 'Flying Shooter',
    movement: 'flies-at-range',
    movementSpeed: { type: 'variable', maximumBlocksPerSecondExclusive: 20 },
    dimensions: { length: 1.3, width: 0.4, height: 0.67 },
    attack: 'projectile',
    attackRange: 'long',
    healthPoints: 60,
    damagePerAttack: 10,
    behavior: [
      'Roams in the sky while keeping away from the player.',
      'Fires projectiles while roaming.',
    ],
    attackAccuracyPercent: 50,
    description: 'Keeps away from the player, roaming in the sky and firing with 50% accuracy.',
  },
  {
    id: 'teleporting-ghost',
    name: 'Teleporting Ghost',
    movement: 'roams-and-teleports',
    movementSpeed: { type: 'variable', maximumBlocksPerSecondExclusive: 14 },
    dimensions: { length: 0.6, width: 0.99, height: 3.4 },
    attack: 'unspecified',
    attackRange: 'unspecified',
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
      blockedWhenPlayerHitIntervalUnderSeconds: 1.37,
    },
    description: 'Roams idly until attacked, then teleports near and attacks the player; rapid player hits can block teleporting.',
  },
];