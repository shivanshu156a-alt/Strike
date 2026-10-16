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
    dimensions: { length: 0.46, width: 0.87, height: 1.74 },
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
    dimensions: { length: 0.46, width: 0.87, height: 1.9 },
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
    dimensions: { length: 0.3, width: 0.7, height: 0.99 },
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
    dimensions: { length: 1.3, width: 0.67, height: 0.4 },
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
    dimensions: { length: 0.6, width: 0.99, height: 3.4 },
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