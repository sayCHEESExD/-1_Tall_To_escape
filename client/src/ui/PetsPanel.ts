import {
  FOOD_TIERS,
  PET_LIMITS,
  RARITIES,
  bestOwnedFood,
  formatNumber,
  isFoodOwned,
  parsePets,
  petById,
  petFoodMultiplier,
  petWinsMultiplier,
} from '@highjump/shared';
import { ICONS, iconUrl } from './hudStyles.js';
import { Panel } from './Panel.js';

const hex = (value: number): string => `#${value.toString(16).padStart(6, '0')}`;

/** "x2.5", "x131": multipliers without trailing zeros. */
const times = (value: number): string =>
  `x${value >= 1000 ? formatNumber(value) : Number(value.toFixed(value >= 10 ? 0 : 2)).toString()}`;

export interface PetActions {
  equipBest(): void;
  equipAll(): void;
  toggle(index: number): void;
  remove(index: number): void;
}

/**
 * The Pets inventory: owned pets (at most `PET_LIMITS.maxOwned`) and, on a
 * second tab, the foods owned.
 *
 * Select a pet to equip/unequip or delete it; Equip Best wears the best three,
 * Equip All fills the free slots. Delete needs a second click to confirm.
 * Every action only asks.
 */
export class PetsPanel extends Panel {
  private readonly title: HTMLDivElement;
  private readonly summary: HTMLParagraphElement;
  private readonly grid: HTMLDivElement;
  private readonly toggleButton: HTMLButtonElement;
  private readonly deleteButton: HTMLButtonElement;
  private readonly bestButton: HTMLButtonElement;
  private readonly allButton: HTMLButtonElement;
  private readonly actionsRow: HTMLDivElement;
  private readonly tabs = new Map<'pets' | 'foods', HTMLButtonElement>();
  private tab: 'pets' | 'foods' = 'pets';
  private pets = '';
  private ownedFoods = 1;
  private selected = -1;
  private confirmDelete = false;

  constructor(parent: HTMLElement, private readonly actions: PetActions) {
    super(parent, 'pets', 'Pets', ICONS.pets);

    const tabs = document.createElement('div');
    tabs.className = 'hj-bp__tabs';
    const addTab = (key: 'pets' | 'foods', label: string, image: string): void => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'hj-bp__tab hj-font';
      button.innerHTML = `${image}<span class="hj-outline"></span>`;
      (button.querySelector('span') as HTMLSpanElement).textContent = label;
      button.addEventListener('click', () => {
        this.tab = key;
        this.selected = -1;
        this.render();
      });
      tabs.appendChild(button);
      this.tabs.set(key, button);
    };
    addTab('pets', 'Pets', `<img src="${iconUrl('inventory.png')}" alt="">`);
    addTab('foods', 'Foods', ICONS.food);

    const frame = document.createElement('div');
    frame.className = 'hj-bp__frame';
    this.title = document.createElement('div');
    this.title.className = 'hj-bp__title hj-font hj-outline';
    this.summary = document.createElement('p');
    this.summary.className = 'hj-shop__summary';
    this.grid = document.createElement('div');
    this.grid.className = 'hj-bp__grid';
    frame.append(this.title, this.summary, this.grid);

    this.actionsRow = document.createElement('div');
    this.actionsRow.className = 'hj-bp__actions';
    this.bestButton = this.button('Equip Best', 'hj-btn--gold', () => actions.equipBest());
    this.allButton = this.button('Equip All', 'hj-btn--green', () => actions.equipAll());
    this.toggleButton = this.button('Equip', 'hj-btn--blue', () => {
      if (this.selected >= 0) actions.toggle(this.selected);
    });
    this.deleteButton = this.button('Delete', 'hj-btn--red', () => {
      if (this.selected < 0) return;
      if (!this.confirmDelete) {
        this.confirmDelete = true;
        this.render();
        return;
      }
      actions.remove(this.selected);
      this.selected = -1;
      this.confirmDelete = false;
    });
    this.actionsRow.append(this.bestButton, this.allButton, this.toggleButton, this.deleteButton);

    this.body.append(tabs, frame, this.actionsRow);
    this.render();
  }

  setInventory(pets: string, ownedFoods: number): void {
    if (pets === this.pets && ownedFoods === this.ownedFoods) return;
    if (parsePets(pets).length !== parsePets(this.pets).length) {
      this.selected = -1;
      this.confirmDelete = false;
    }
    this.pets = pets;
    this.ownedFoods = ownedFoods;
    this.render();
  }

  protected override onOpened(): void {
    this.confirmDelete = false;
    this.render();
  }

  private button(label: string, variant: string, onClick: () => void): HTMLButtonElement {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `hj-btn ${variant} hj-font`;
    button.textContent = label;
    button.addEventListener('click', () => {
      if (!button.disabled) onClick();
    });
    return button;
  }

  private render(): void {
    for (const [key, button] of this.tabs) button.classList.toggle('hj-bp__tab--on', key === this.tab);
    this.grid.textContent = '';

    if (this.tab === 'foods') {
      this.actionsRow.hidden = true;
      const held = bestOwnedFood(this.ownedFoods);
      const owned = FOOD_TIERS.filter((tier) => isFoodOwned(this.ownedFoods, tier.slot));
      this.title.textContent = `Foods (${owned.length}/${FOOD_TIERS.length})`;
      this.summary.textContent = 'Your best food is always the one you hold and eat.';
      for (const tier of owned) {
        const card = this.card(tier.name, hex(tier.color), hex(tier.accent), `+${formatNumber(tier.foodPerStep)}/Step`, 'Common', false);
        if (held.slot === tier.slot) this.badge(card, 'Held');
        this.grid.appendChild(card);
      }
      return;
    }

    this.actionsRow.hidden = false;
    const pets = parsePets(this.pets);
    const equipped = pets.filter((pet) => pet.equipped).length;
    this.title.textContent = `Pets (${pets.length}/${PET_LIMITS.maxOwned}) - Equipped ${equipped}/${PET_LIMITS.maxEquipped}`;
    this.summary.textContent = `Equipped bonus: ${times(petFoodMultiplier(this.pets))} Food, ${times(petWinsMultiplier(this.pets))} Wins`;
    if (pets.length === 0) this.empty('Hatch eggs at the Egg Shop by the stairs.');
    pets.forEach((entry, index) => {
      const pet = petById(entry.id);
      if (!pet) return;
      const card = this.card(
        pet.name,
        hex(pet.color),
        hex(pet.accent),
        `${times(pet.food)} Food / ${times(pet.wins)} Wins`,
        pet.rarity,
        true,
      );
      card.classList.add('hj-bp__item');
      if (entry.equipped) this.badge(card, 'Equipped');
      if (index === this.selected) card.classList.add('hj-bp__item--sel');
      card.addEventListener('click', () => {
        this.selected = index === this.selected ? -1 : index;
        this.confirmDelete = false;
        this.render();
      });
      this.grid.appendChild(card);
    });

    const chosen = pets[this.selected];
    this.bestButton.disabled = pets.length === 0;
    this.allButton.disabled = pets.length === 0 || equipped >= PET_LIMITS.maxEquipped || equipped === pets.length;
    this.toggleButton.disabled = !chosen || (!chosen.equipped && equipped >= PET_LIMITS.maxEquipped);
    this.toggleButton.textContent = chosen?.equipped ? 'Unequip' : 'Equip';
    this.deleteButton.disabled = !chosen;
    this.deleteButton.textContent = this.confirmDelete ? 'Confirm Delete' : 'Delete';
  }

  private card(
    name: string,
    color: string,
    accent: string,
    bonus: string,
    rarity: keyof typeof RARITIES,
    showRarity: boolean,
  ): HTMLDivElement {
    const card = document.createElement('div');
    card.className = 'hj-card hj-font';
    card.style.background = `linear-gradient(180deg, ${RARITIES[rarity].color}, #1f2937)`;
    card.innerHTML =
      '<div class="hj-card__pet"></div><div class="hj-card__name hj-outline"></div>' +
      '<div class="hj-card__rarity hj-card__rarity--small hj-outline"></div><div class="hj-card__bonus hj-outline"></div>';
    (card.querySelector('.hj-card__pet') as HTMLDivElement).style.background =
      `radial-gradient(circle at 35% 30%, ${accent}, ${color} 60%)`;
    (card.querySelector('.hj-card__name') as HTMLDivElement).textContent = name;
    (card.querySelector('.hj-card__rarity') as HTMLDivElement).textContent = showRarity ? rarity : '';
    (card.querySelector('.hj-card__bonus') as HTMLDivElement).textContent = bonus;
    return card;
  }

  private badge(card: HTMLDivElement, text: string): void {
    const badge = document.createElement('span');
    badge.className = 'hj-bp__equipped hj-outline';
    badge.textContent = text;
    card.style.position = 'relative';
    card.appendChild(badge);
  }

  private empty(text: string): void {
    const note = document.createElement('p');
    note.className = 'hj-bp__empty';
    note.textContent = text;
    this.grid.appendChild(note);
  }
}
