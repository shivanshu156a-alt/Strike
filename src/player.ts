export interface WeaponCombatProfile {
  readonly attackRange: number;
  readonly attackDamage: number;
}

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

  get health(): number {
    return this.currentHealth;
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
