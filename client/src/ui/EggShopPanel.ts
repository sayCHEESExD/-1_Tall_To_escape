import { EGGS, PET_LIMITS, RARITIES, formatNumber, parsePets, petsInEgg } from '@highjump/shared';
import { ICONS } from './hudStyles.js';
import { Panel } from './Panel.js';

const hex = (value: number): string => `#${value.toString(16).padStart(6, '0')}`;

const times = (value: number): string => `x${Number(value.toFixed(value >= 10 ? 0 : 2))}`;

/**
 * The Egg Shop, opened by walking up to the egg stall.
 *
 * One row per egg: its shell, its price, and its four pets with their rarity,
 * chance and bonuses. Each Hatch button ASKS the server, which re-checks the
 * stall position, the inventory space and the Wins, and rolls the pet itself.
 */
export class EggShopPanel extends Panel {
  private readonly note: HTMLParagraphElement;
  private readonly buttons: HTMLButtonElement[] = [];
  private signature = '';
  private wins = 0;
  private full = false;
  private atShop = false;

  constructor(parent: HTMLElement, private readonly onHatch: (slot: number) => void) {
    super(parent, 'shop', 'Egg Shop', ICONS.shop);
    const list = document.createElement('div');
    for (const egg of EGGS) {
      const row = document.createElement('div');
      row.className = 'hj-egg hj-font';
      row.style.background = `linear-gradient(90deg, ${hex(egg.color)}, #3b2a78)`;

      const shell = document.createElement('div');
      shell.className = 'hj-egg__shell';
      shell.style.background = `radial-gradient(circle at 35% 30%, #ffffff, ${hex(egg.color)} 45%, ${hex(egg.accent)})`;

      const text = document.createElement('div');
      const name = document.createElement('div');
      name.className = 'hj-egg__name hj-outline';
      name.textContent = egg.name;
      const pets = document.createElement('div');
      pets.className = 'hj-egg__pets';
      for (const pet of petsInEgg(egg.slot)) {
        const chip = document.createElement('div');
        chip.className = 'hj-egg__pet hj-outline';
        chip.style.borderColor = RARITIES[pet.rarity].color;
        chip.innerHTML = '<b></b><span></span><br><i></i>';
        (chip.querySelector('b') as HTMLElement).textContent = pet.name;
        (chip.querySelector('span') as HTMLElement).textContent = `${pet.rarity} ${pet.chance}%`;
        (chip.querySelector('i') as HTMLElement).textContent = `${times(pet.food)} Food`;
        chip.title = `${pet.name} (${pet.rarity}, ${pet.chance}%): ${times(pet.food)} Food, ${times(pet.wins)} Wins`;
        pets.appendChild(chip);
      }
      text.append(name, pets);

      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'hj-btn hj-btn--wins hj-font';
      button.innerHTML = `${ICONS.trophy}<span>${formatNumber(egg.cost)}</span>`;
      button.addEventListener('click', () => {
        if (!button.disabled) this.onHatch(egg.slot);
      });

      row.append(shell, text, button);
      list.appendChild(row);
      this.buttons.push(button);
    }
    this.note = document.createElement('p');
    this.note.className = 'hj-shop__note';
    this.body.append(list, this.note);
    this.render();
  }

  /** Mirror everything the buttons depend on. Cheap when nothing changed. */
  sync(wins: number, pets: string, atShop: boolean): void {
    const full = parsePets(pets).length >= PET_LIMITS.maxOwned;
    const signature = `${Math.floor(wins)}|${full}|${atShop}`;
    if (signature === this.signature) return;
    this.signature = signature;
    this.wins = wins;
    this.full = full;
    this.atShop = atShop;
    this.render();
  }

  private render(): void {
    EGGS.forEach((egg, index) => {
      const button = this.buttons[index];
      if (button) button.disabled = this.full || !this.atShop || this.wins < egg.cost;
    });
    this.note.textContent = !this.atShop
      ? 'Walk up to the Egg Shop to hatch.'
      : this.full
        ? `Pet inventory full (${PET_LIMITS.maxOwned}/${PET_LIMITS.maxOwned}) - delete a pet to hatch more.`
        : `Equip up to ${PET_LIMITS.maxEquipped} pets to multiply your food and wins.`;
  }
}
