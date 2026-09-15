/**
 * The Dining Hall: four dining table sets along the back of the hub.
 *
 * Sitting at a table (standing on one of its chairs) eats on the spot and pays
 * food as if the player were walking `DINING.eatStepsPerSecond` steps a second,
 * times the table's Height Power. A table the player has not unlocked (by
 * rebirth count) pays nothing - this is the one rebirth requirement in the game.
 *
 * There is no dining message: the seat is derived from POSITION by the shared
 * simulation on both sides, and the gate is checked by the server with the
 * payment.
 */
export interface DiningTier {
  /** 1-based, left to right as seen from spawn. */
  readonly index: number;
  readonly name: string;
  readonly rebirthsRequired: number;
  /** Food multiplier while seated. */
  readonly multiplier: number;
  /** Floor mat colour under the set. */
  readonly color: number;
  /** Mat border / highlight. */
  readonly glow: number;
  /** Table and chair colour. */
  readonly furniture: number;
  /** The "xN Height Power" sign's text colour. */
  readonly textColor: string;
}

export const DINING_TIERS: readonly DiningTier[] = [
  { index: 1, name: '1x Height Power', rebirthsRequired: 0, multiplier: 1, color: 0xff8a3d, glow: 0xffc08a, furniture: 0x9c5a32, textColor: '#ff9a3d' },
  { index: 2, name: '3x Height Power', rebirthsRequired: 2, multiplier: 3, color: 0xf4e9ff, glow: 0xffffff, furniture: 0xf2eefa, textColor: '#f5ecff' },
  { index: 3, name: '5x Height Power', rebirthsRequired: 5, multiplier: 5, color: 0x7dff3a, glow: 0xd4ff9a, furniture: 0x3fc43a, textColor: '#8dff4a' },
  { index: 4, name: '7x Height Power', rebirthsRequired: 10, multiplier: 7, color: 0xff3b4a, glow: 0xff9aa2, furniture: 0xe0313f, textColor: '#ff5a66' },
];

export const DINING = {
  /** Centre of the tables along Z, near the back wall. */
  centerZ: -68,
  /** Table centres along X, one per tier. The player's left (+X) is tier 1. */
  xs: [39, 13, -13, -39] as readonly number[],
  /** Table top footprint and height. The table is SOLID. */
  tableWidth: 10,
  tableDepth: 4.4,
  /** Above `MOVEMENT.stepHeight`, so nobody walks onto the table. */
  tableHeight: 1.5,
  /** Chair centres relative to the table centre: two chairs on each long side. */
  chairOffsetX: 2.6,
  chairOffsetZ: 4.4,
  /** The square a seated player stands in. */
  seatSize: 3.2,
  /** The coloured floor mat under each set. */
  matWidth: 20,
  matDepth: 16,
  /** Steps' worth of eating paid per second while seated: a little more than walking (~1.2/s). */
  eatStepsPerSecond: 1.5,
} as const;

export const diningByIndex = (index: number): DiningTier | undefined =>
  DINING_TIERS.find((tier) => tier.index === Math.floor(index));

/** Food multiplier the table pays at, or 0 when locked for this player. */
export const diningRate = (index: number, rebirths: number): number => {
  const tier = diningByIndex(index);
  if (!tier) return 0;
  return rebirths >= tier.rebirthsRequired ? tier.multiplier : 0;
};

/** Chair centres of one table, as offsets from the table centre. */
export const CHAIR_OFFSETS: readonly { readonly x: number; readonly z: number }[] = [
  { x: -DINING.chairOffsetX, z: -DINING.chairOffsetZ },
  { x: DINING.chairOffsetX, z: -DINING.chairOffsetZ },
  { x: -DINING.chairOffsetX, z: DINING.chairOffsetZ },
  { x: DINING.chairOffsetX, z: DINING.chairOffsetZ },
];

/** Which table, if any, the player is seated at (standing on one of its chairs). */
export const diningSeatAt = (x: number, y: number, z: number): number => {
  if (y > 0.6 || y < -0.6) return 0;
  const half = DINING.seatSize / 2;
  if (Math.abs(z - DINING.centerZ) > DINING.chairOffsetZ + half) return 0;
  for (let i = 0; i < DINING.xs.length; i += 1) {
    const cx = DINING.xs[i] ?? 0;
    for (const chair of CHAIR_OFFSETS) {
      if (Math.abs(x - (cx + chair.x)) <= half && Math.abs(z - (DINING.centerZ + chair.z)) <= half) return i + 1;
    }
  }
  return 0;
};
