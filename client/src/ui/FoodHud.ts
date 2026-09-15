import { foodForNextLevel, formatNumber } from '@highjump/shared';
import { ICONS, injectHudStyles } from './hudStyles.js';

/**
 * The bottom HUD: Height and food per step above the bar, Rebirth to the
 * right, the next step's level requirement, and the level bar showing food
 * banked toward the next level.
 *
 * Renders replicated server state only, and writes to the DOM only on change.
 * The food per step shown is the server's own `foodPerStep` - exactly what a
 * walking step pays.
 */
export class FoodHud {
  private readonly root: HTMLDivElement;
  private readonly height: HTMLDivElement;
  private readonly rate: HTMLDivElement;
  private readonly rebirth: HTMLDivElement;
  private readonly next: HTMLDivElement;
  private readonly fill: HTMLDivElement;
  private readonly level: HTMLDivElement;
  private readonly amount: HTMLSpanElement;
  private last = '';
  private lastLevel = -1;

  constructor(parent: HTMLElement) {
    injectHudStyles();
    this.root = document.createElement('div');
    this.root.className = 'hj-hud hj-font';
    this.root.innerHTML =
      '<div class="hj-hud__next hj-outline"></div>' +
      '<div class="hj-hud__row"><div><div class="hj-hud__height hj-outline"></div>' +
      '<div class="hj-hud__rate hj-outline"></div></div><div class="hj-hud__rebirth"></div></div>' +
      '<div class="hj-hud__bar"><div class="hj-hud__fill"></div>' +
      '<div class="hj-hud__level hj-outline"></div>' +
      `<div class="hj-hud__amount hj-outline">${ICONS.food}<span></span></div></div>`;
    this.height = this.root.querySelector('.hj-hud__height') as HTMLDivElement;
    this.rate = this.root.querySelector('.hj-hud__rate') as HTMLDivElement;
    this.rebirth = this.root.querySelector('.hj-hud__rebirth') as HTMLDivElement;
    this.next = this.root.querySelector('.hj-hud__next') as HTMLDivElement;
    this.fill = this.root.querySelector('.hj-hud__fill') as HTMLDivElement;
    this.level = this.root.querySelector('.hj-hud__level') as HTMLDivElement;
    this.amount = this.root.querySelector('.hj-hud__amount span') as HTMLSpanElement;
    parent.appendChild(this.root);
  }

  /**
   * @param foodPerStep   the server's replicated food per walking step
   * @param nextStepLevel the recommended level of the next step above this
   *                      level, or 0 past the top (a hint, never a gate)
   */
  update(
    level: number,
    food: number,
    rebirths: number,
    height: number,
    foodPerStep: number,
    nextStepLevel: number,
  ): void {
    const required = foodForNextLevel(level, rebirths);
    const signature = `${level}|${Math.floor(food)}|${rebirths}|${Math.floor(height)}|${foodPerStep}|${nextStepLevel}`;
    if (signature === this.last) return;
    this.last = signature;

    this.height.textContent = `Height: ${formatNumber(Math.floor(height))}`;
    this.rate.textContent = `Food: +${formatNumber(foodPerStep)}/step`;
    this.rebirth.textContent = `Rebirth: ${rebirths}`;
    this.next.textContent = nextStepLevel > 0 ? `Next step: Level ${nextStepLevel} recommended` : 'Your legs reach every step!';
    this.next.classList.toggle('hj-hud__next--open', nextStepLevel <= 0);
    this.level.textContent = `Level ${level}`;
    this.amount.textContent = `${formatNumber(food)}/${formatNumber(required)}`;
    this.fill.style.width = `${Math.min(100, Math.max(0, (food / required) * 100)).toFixed(2)}%`;

    if (this.lastLevel >= 0 && level > this.lastLevel) {
      this.root.classList.remove('hj-hud--levelup');
      void this.root.offsetWidth;
      this.root.classList.add('hj-hud--levelup');
    }
    this.lastLevel = level;
  }

  dispose(): void {
    this.root.remove();
  }
}
