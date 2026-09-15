import { formatNumber } from '@highjump/shared';
import { ICONS, injectHudStyles } from './hudStyles.js';

/** The Wins total, upper centre. Pops when the replicated total rises. */
export class WinsCounter {
  private readonly root: HTMLDivElement;
  private readonly value: HTMLDivElement;
  private last = -1;
  private popTimer = 0;

  constructor(parent: HTMLElement) {
    injectHudStyles();
    this.root = document.createElement('div');
    this.root.className = 'hj-wins hj-font';
    const icon = document.createElement('div');
    icon.className = 'hj-wins__icon';
    icon.innerHTML = ICONS.trophy;
    this.value = document.createElement('div');
    this.value.className = 'hj-wins__value';
    this.value.textContent = '0';
    this.root.append(icon, this.value);
    parent.appendChild(this.root);
  }

  update(wins: number): void {
    if (wins === this.last) return;
    const rose = this.last >= 0 && wins > this.last;
    this.last = wins;
    this.value.textContent = formatNumber(wins);
    if (!rose) return;
    this.root.classList.remove('hj-wins--pop');
    void this.root.offsetWidth;
    this.root.classList.add('hj-wins--pop');
    window.clearTimeout(this.popTimer);
    this.popTimer = window.setTimeout(() => this.root.classList.remove('hj-wins--pop'), 560);
  }

  dispose(): void {
    window.clearTimeout(this.popTimer);
    this.root.remove();
  }
}
