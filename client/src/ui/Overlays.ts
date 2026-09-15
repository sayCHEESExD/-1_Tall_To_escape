import { injectHudStyles } from './hudStyles.js';

/** The desktop key hints, bottom right. Hidden in touch mode by CSS. */
export class KeyHints {
  private readonly root: HTMLDivElement;

  constructor(parent: HTMLElement) {
    injectHudStyles();
    this.root = document.createElement('div');
    this.root.className = 'hj-keys hj-font';
    const hints: [string, string][] = [
      ['WASD', 'Walk (and eat)'],
      ['Space', 'Jump (spawn area only)'],
      ['P', 'Pets'],
      ['Wheel', 'Zoom'],
      ['Esc', 'Free cursor'],
    ];
    for (const [key, label] of hints) {
      const row = document.createElement('span');
      const cap = document.createElement('b');
      cap.textContent = key;
      row.append(cap, label);
      this.root.appendChild(row);
    }
    parent.appendChild(this.root);
  }

  dispose(): void {
    this.root.remove();
  }
}

/** "+15 WINS!" across the upper middle when a win lands. One reused node. */
export class WinBanner {
  private readonly root: HTMLDivElement;

  constructor(parent: HTMLElement) {
    injectHudStyles();
    this.root = document.createElement('div');
    this.root.className = 'hj-banner hj-font hj-outline';
    parent.appendChild(this.root);
  }

  show(text: string): void {
    this.root.textContent = text;
    this.root.style.color = '#ffd23d';
    this.root.classList.remove('hj-banner--run');
    void this.root.offsetWidth;
    this.root.classList.add('hj-banner--run');
  }

  dispose(): void {
    this.root.remove();
  }
}
