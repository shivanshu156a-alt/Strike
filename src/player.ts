export interface WeaponCombatProfile {
  readonly attackRange: number;
  readonly attackDamage: number;
}

export type PlayerAttackId = 'fists' | 'melee' | 'shooter';

export interface PlayerAttackProfile extends WeaponCombatProfile {
  readonly id: PlayerAttackId;
  readonly name: string;
  readonly attackCooldownSeconds: number;
  readonly mode: 'melee' | 'projectile';
  readonly projectileSpeed?: number;
}

export const PLAYER_ATTACKS: readonly PlayerAttackProfile[] = [
  {
    id: 'fists',
    name: 'Fists',
    attackRange: 1.6,
    attackDamage: 10,
    attackCooldownSeconds: 0.3,
    mode: 'melee',
  },
  {
    id: 'melee',
    name: 'Melee',
    attackRange: 3.2,
    attackDamage: 10,
    attackCooldownSeconds: 0.55,
    mode: 'melee',
  },
  {
    id: 'shooter',
    name: 'Shooter',
    attackRange: 80,
    attackDamage: 10,
    attackCooldownSeconds: 0.25,
    mode: 'projectile',
    projectileSpeed: 35,
  },
];

export const TEST_SHOOTER_WEAPON = PLAYER_ATTACKS[2];

export interface PlayerHealthChange {
  health: number;
  maxHealth: number;
}

export class Player extends EventTarget {
  readonly maxHealth = 100;
  readonly height = 1.74;
  readonly width = 0.87;
  readonly length = 0.46;

  private currentHealth = this.maxHealth;
  private currentAttackIndex = 0;

  get health(): number {
    return this.currentHealth;
  }

  get selectedAttack(): PlayerAttackProfile {
    return PLAYER_ATTACKS[this.currentAttackIndex];
  }

  get selectedAttackIndex(): number {
    return this.currentAttackIndex;
  }

  get equippedWeapon(): PlayerAttackProfile {
    return this.selectedAttack;
  }

  selectAttack(index: number): boolean {
    if (!Number.isInteger(index) || index < 0 || index >= PLAYER_ATTACKS.length) return false;
    this.currentAttackIndex = index;
    return true;
  }

  takeDamage(amount: number): void {
    this.validateHealthAmount(amount);
    this.setHealth(this.currentHealth - amount);
  }

  restoreHealth(amount: number): void {
    this.validateHealthAmount(amount);
    this.setHealth(this.currentHealth + amount);
  }

  private validateHealthAmount(amount: number): void {
    if (!Number.isFinite(amount) || amount < 0) {
      throw new RangeError('Health change must be a finite, non-negative number.');
    }
  }

  private setHealth(health: number): void {
    const nextHealth = Math.min(this.maxHealth, Math.max(0, health));
    if (nextHealth === this.currentHealth) return;

    this.currentHealth = nextHealth;
    const detail: PlayerHealthChange = { health: this.currentHealth, maxHealth: this.maxHealth };
    this.dispatchEvent(new CustomEvent<PlayerHealthChange>('healthchange', { detail }));
  }
}
