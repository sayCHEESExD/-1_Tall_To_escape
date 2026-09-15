import { canRebirth, rebirthHeightMultiplier, rebirthRequiredLevel } from '@highjump/shared';
import { ICONS } from './hudStyles.js';
import { Panel } from './Panel.js';

/** A green up arrow beside the height multiplier. */
const ARROW =
  '<svg class="hj-rb__arrow" viewBox="0 0 24 24" aria-hidden="true">' +
  '<path d="M12 2 3 12h5v10h8V12h5z" fill="#3ddc3d" stroke="#12181f" stroke-width="1.6" stroke-linejoin="round"/></svg>';

/** "1.5", "2": the multiplier without trailing zeros. */
const times = (value: number): string => Number(value.toFixed(2)).toString();

/**
 * The rebirth screen, laid out as the reference: "Before:" and "After:" height
 * multipliers side by side, the reset stated in red, a bar showing the level
 * against the NEXT rebirth's requirement (it climbs with every rebirth), and
 * the Rebirth button.
 *
 * The button only ASKS; the server decides. Everything shown is derived from
 * the replicated level and rebirth count, so it updates as soon as a rebirth
 * lands.
 */
export class RebirthPanel extends Panel {
  private readonly before: HTMLSpanElement;
  private readonly after: HTMLSpanElement;
  private readonly fill: HTMLDivElement;
  private readonly barLabel: HTMLSpanElement;
  private readonly action: HTMLButtonElement;
  private level = 1;
  private rebirths = 0;

  constructor(parent: HTMLElement, onRebirth: () => void) {
    super(parent, 'rebirth', 'Rebirth', ICONS.rebirth);

    const columns = document.createElement('div');
    columns.className = 'hj-rb__cols hj-font';
    const column = (label: string): HTMLSpanElement => {
      const wrap = document.createElement('div');
      const title = document.createElement('div');
      title.className = 'hj-rb__label hj-outline';
      title.textContent = label;
      const card = document.createElement('div');
      card.className = 'hj-rb__card hj-outline';
      card.innerHTML = ARROW;
      const value = document.createElement('span');
      card.appendChild(value);
      wrap.append(title, card);
      columns.appendChild(wrap);
      return value;
    };
    this.before = column('Before:');
    this.after = column('After:');

    const warn = document.createElement('p');
    warn.className = 'hj-rb__warn hj-font hj-outline';
    warn.textContent = '*Rebirth Resets your Height*';

    const bar = document.createElement('div');
    bar.className = 'hj-rb__bar hj-font';
    this.fill = document.createElement('div');
    this.fill.className = 'hj-rb__fill';
    this.barLabel = document.createElement('span');
    this.barLabel.className = 'hj-rb__barlabel hj-outline';
    bar.append(this.fill, this.barLabel);

    const actions = document.createElement('div');
    actions.className = 'hj-rb__actions';
    this.action = this.button('Rebirth', 'hj-rb__go', () => {
      if (this.action.disabled) return;
      onRebirth();
      this.setOpen(false);
    });
    actions.append(this.action);

    this.body.append(columns, warn, bar, actions);
    this.render();
  }

  get isEligible(): boolean {
    return canRebirth(this.level, this.rebirths);
  }

  setProgress(level: number, rebirths: number): void {
    if (level === this.level && rebirths === this.rebirths) return;
    this.level = level;
    this.rebirths = rebirths;
    this.render();
  }

  protected override onOpened(): void {
    this.render();
  }

  private button(label: string, variant: string, onClick: () => void): HTMLButtonElement {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `hj-rb__button ${variant} hj-font hj-outline`;
    button.textContent = label;
    button.addEventListener('click', onClick);
    return button;
  }

  private render(): void {
    const required = rebirthRequiredLevel(this.rebirths);
    this.before.textContent = `${times(rebirthHeightMultiplier(this.rebirths))}x Height`;
    this.after.textContent = `${times(rebirthHeightMultiplier(this.rebirths + 1))}x Height`;
    this.fill.style.width = `${Math.min(1, this.level / required) * 100}%`;
    this.barLabel.textContent = `Level ${this.level}/${required}`;
    this.action.disabled = !this.isEligible;
    this.action.title = this.isEligible ? '' : `Reach Level ${required} to rebirth`;
  }
}
