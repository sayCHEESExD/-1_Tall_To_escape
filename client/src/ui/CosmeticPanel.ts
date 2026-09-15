import { formatNumber } from '@highjump/shared';
import { ICONS } from './hudStyles.js';
import { Panel } from './Panel.js';

/** One row of a cosmetic ladder, already resolved from shared config. */
export interface CosmeticRow {
  readonly slot: number;
  readonly name: string;
  readonly cost: number;
  readonly multiplier: number;
  readonly color: number;
}

export interface CosmeticPanelOptions {
  readonly variant: 'trail';
  readonly title: string;
  readonly icon: string;
  /** Icon beside the multiplier: food for trails. */
  readonly multiplierIcon: string;
  readonly rows: readonly CosmeticRow[];
  onBuy(slot: number): void;
  onEquip(slot: number): void;
}

const hex = (value: number): string => `#${value.toString(16).padStart(6, '0')}`;

/**
 * The Trails menu, as in the reference: a gradient row per tier with
 * the swatch, the name, the multiplier, and a Wins price or Equip button.
 *
 * Mirrors replicated ownership; every button only asks the server.
 */
export class CosmeticPanel extends Panel {
  private readonly buttons = new Map<number, HTMLButtonElement>();
  private owned = 0;
  private equipped = 0;
  private wins = 0;
  private signature = '';

  constructor(parent: HTMLElement, private readonly options: CosmeticPanelOptions) {
    super(parent, options.variant, options.title, options.icon);

    for (const row of options.rows) {
      const node = document.createElement('div');
      node.className = 'hj-cos hj-font';
      const base = hex(row.color);
      node.style.background = `linear-gradient(90deg, ${base}, #7a3bff)`;

      const swatch = document.createElement('div');
      swatch.className = 'hj-cos__swatch';
      swatch.style.background = `radial-gradient(circle at 35% 30%, #ffffff, ${base} 55%, #111827)`;
      swatch.style.setProperty('--hj-glow', base);

      const text = document.createElement('div');
      text.innerHTML =
        `<div class="hj-cos__name hj-outline"></div>` +
        `<div class="hj-cos__mult hj-outline">${options.multiplierIcon}<span></span></div>`;
      (text.querySelector('.hj-cos__name') as HTMLDivElement).textContent = row.name;
      (text.querySelector('.hj-cos__mult span') as HTMLSpanElement).textContent = `x${row.multiplier}`;

      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'hj-btn hj-font';
      button.addEventListener('click', () => {
        if (button.disabled) return;
        if ((this.owned & (1 << (row.slot - 1))) === 0) options.onBuy(row.slot);
        else options.onEquip(this.equipped === row.slot ? 0 : row.slot);
      });

      node.append(swatch, text, button);
      this.body.appendChild(node);
      this.buttons.set(row.slot, button);
    }
    this.render();
  }

  /** True when some unowned tier is affordable - the rail badge. */
  get hasAffordable(): boolean {
    return this.options.rows.some((row) => (this.owned & (1 << (row.slot - 1))) === 0 && this.wins >= row.cost);
  }

  setInventory(owned: number, equipped: number, wins: number): void {
    const signature = `${owned}|${equipped}|${Math.floor(wins)}`;
    if (signature === this.signature) return;
    this.signature = signature;
    this.owned = owned;
    this.equipped = equipped;
    this.wins = wins;
    this.render();
  }

  private render(): void {
    for (const row of this.options.rows) {
      const button = this.buttons.get(row.slot);
      if (!button) continue;
      const owned = (this.owned & (1 << (row.slot - 1))) !== 0;
      if (owned) {
        const worn = this.equipped === row.slot;
        button.className = `hj-btn hj-font ${worn ? 'hj-btn--green' : 'hj-btn--blue'}`;
        button.textContent = worn ? 'Equipped' : 'Equip';
        button.disabled = false;
      } else {
        button.className = 'hj-btn hj-btn--wins hj-font';
        button.innerHTML = `${ICONS.trophy}<span>${formatNumber(row.cost)}</span>`;
        button.disabled = this.wins < row.cost;
      }
    }
  }
}
