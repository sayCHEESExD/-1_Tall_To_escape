import { formatNumber } from '@highjump/shared';
import { FOOD_ICON_URL, injectHudStyles } from './hudStyles.js';

/** Most popups on screen at once. A hard ceiling allocated once. */
const POOL_SIZE = 14;
const LIFETIME = 1.15;
/** Seconds between releases of the accumulated gain. */
const CADENCE = 0.26;

/**
 * The floating "+N" food popups while eating.
 *
 * Driven by an ACCUMULATOR over the replicated lifetime food, never by raw
 * patches: only an increase counts, and the gain is released on a fixed
 * cadence so a trickle reads as "+3" and a feast at a table as "+300". The
 * first reading only takes a baseline, so joining never fires a popup.
 */
export class FoodPopups {
  private readonly root: HTMLDivElement;
  private readonly pool: HTMLDivElement[] = [];
  private readonly free: number[] = [];
  private readonly live: { index: number; timer: number }[] = [];
  private readonly recent: { x: number; y: number }[] = [];
  private pending = 0;
  private cooldown = 0;
  private lastTotal = -1;

  constructor(parent: HTMLElement) {
    injectHudStyles();
    this.root = document.createElement('div');
    this.root.className = 'hj-pops';
    parent.appendChild(this.root);
    for (let i = 0; i < POOL_SIZE; i += 1) {
      const node = document.createElement('div');
      node.className = 'hj-pop hj-font';
      node.innerHTML =
        `<img class="hj-pop__icon" src="${FOOD_ICON_URL}" alt="" draggable="false">` +
        '<span class="hj-pop__value"></span>';
      node.hidden = true;
      this.root.appendChild(node);
      this.pool.push(node);
      this.free.push(i);
    }
  }

  observe(total: number): void {
    if (!Number.isFinite(total)) return;
    if (this.lastTotal < 0 || total < this.lastTotal) {
      this.lastTotal = total;
      return;
    }
    this.pending += total - this.lastTotal;
    this.lastTotal = total;
  }

  update(delta: number): void {
    this.cooldown -= Math.max(0, delta);
    if (this.cooldown > 0) return;
    this.cooldown = CADENCE;
    if (this.pending < 1) return;
    const amount = Math.floor(this.pending);
    this.pending -= amount;
    this.spawn(amount);
  }

  dispose(): void {
    for (const entry of this.live) window.clearTimeout(entry.timer);
    this.root.remove();
  }

  private spawn(amount: number): void {
    if (this.free.length === 0) {
      const oldest = this.live.shift();
      if (!oldest) return;
      window.clearTimeout(oldest.timer);
      this.release(oldest.index);
    }
    const index = this.free.pop();
    const node = index === undefined ? undefined : this.pool[index];
    if (index === undefined || !node) return;

    const value = node.querySelector('.hj-pop__value');
    if (value) value.textContent = `+${formatNumber(amount)}`;

    // A random spot in a band that misses the Wins counter, the rail and the bar.
    let x = 0;
    let y = 0;
    for (let attempt = 0; attempt < 6; attempt += 1) {
      x = 28 + Math.random() * 54;
      y = 24 + Math.random() * 34;
      if (!this.recent.some((at) => Math.abs(at.x - x) < 11 && Math.abs(at.y - y) < 9)) break;
    }
    this.recent.push({ x, y });
    if (this.recent.length > 5) this.recent.shift();

    node.style.left = `${x}%`;
    node.style.top = `${y}%`;
    node.style.setProperty('--hj-pop-tilt', `${(Math.random() * 2 - 1) * 7}deg`);
    node.style.setProperty('--hj-pop-scale', `${0.88 + Math.random() * 0.28}`);
    node.hidden = false;
    node.classList.remove('hj-pop--run');
    void node.offsetWidth;
    node.classList.add('hj-pop--run');

    const timer = window.setTimeout(() => {
      const at = this.live.findIndex((entry) => entry.index === index);
      if (at >= 0) this.live.splice(at, 1);
      this.release(index);
    }, LIFETIME * 1000);
    this.live.push({ index, timer });
  }

  private release(index: number): void {
    const node = this.pool[index];
    if (!node) return;
    node.hidden = true;
    node.classList.remove('hj-pop--run');
    this.free.push(index);
  }
}
