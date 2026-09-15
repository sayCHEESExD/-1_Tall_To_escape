import { injectHudStyles } from './hudStyles.js';

/**
 * How many panels are open. The input layer polls this to suppress movement.
 * A COUNT, so two panels closing out of order cannot leave the game suppressed.
 */
let openCount = 0;

export const anyPanelOpen = (): boolean => openCount > 0;

/** A modal panel: a titled studded box over a dimmed backdrop. */
export class Panel {
  protected readonly root: HTMLDivElement;
  protected readonly body: HTMLDivElement;
  private open = false;
  private closeListener: (() => void) | null = null;

  constructor(parent: HTMLElement, variant: string, title: string, iconHtml = '') {
    injectHudStyles();
    this.root = document.createElement('div');
    this.root.className = `hj-panel hj-panel--${variant}`;
    this.root.hidden = true;

    const box = document.createElement('div');
    box.className = 'hj-panel__box';

    const head = document.createElement('div');
    head.className = 'hj-panel__head hj-font hj-outline';
    head.innerHTML = iconHtml;
    const heading = document.createElement('span');
    heading.textContent = title;
    head.appendChild(heading);

    const close = document.createElement('button');
    close.type = 'button';
    close.className = 'hj-panel__close hj-font';
    close.setAttribute('aria-label', 'Close');
    close.textContent = '✖';
    close.addEventListener('click', () => this.setOpen(false));

    this.body = document.createElement('div');
    this.body.className = 'hj-panel__body';
    box.append(head, close, this.body);
    this.root.appendChild(box);

    this.root.addEventListener('click', (event) => {
      if (event.target === this.root) this.setOpen(false);
    });
    parent.appendChild(this.root);
  }

  get isOpen(): boolean {
    return this.open;
  }

  /** Called whenever the panel closes, by any route. */
  onClose(listener: () => void): void {
    this.closeListener = listener;
  }

  toggle(): void {
    this.setOpen(!this.open);
  }

  setOpen(open: boolean): void {
    if (open === this.open) return;
    this.open = open;
    this.root.hidden = !open;
    openCount = Math.max(0, openCount + (open ? 1 : -1));
    if (open) this.onOpened();
    else this.closeListener?.();
  }

  protected onOpened(): void {
    /* subclasses refresh here */
  }

  dispose(): void {
    if (this.open) this.setOpen(false);
    this.root.remove();
  }
}
