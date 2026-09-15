/**
 * Colours and look for the world. Presentation only - nothing here changes
 * gameplay, and every gameplay number lives in `shared/`.
 */
export const PALETTE = {
  sky: 0x7cc8ff,
  fog: 0xbfe6ff,
  cloud: 0xffffff,
  cloudShade: 0xdcecf8,
  hubFloor: '#4f8cff',
  hubFloorLine: '#3b74e0',
  hubWall: 0x8fa3b8,
  hubWallTop: 0x39c24a,
  grass: '#39c24a',
  grassLine: '#2ea83d',
  padGold: '#ffc933',
  padGoldLine: '#e0a412',
  foodPad: 0xe23b3b,
  foodPadOwned: 0x39c24a,
  tableWood: 0xa86a36,
  tableWoodDark: 0x6b4220,
  chairWood: 0xc98a4a,
  tallLine: 0x5ce1ff,
  stairTop: '#b3acbd',
  stairTopLine: '#9d96a8',
  stairFace: '#8d8698',
  stairFaceMark: '#7c7588',
  stairWall: '#d9683a',
  stairWallLine: '#bf5530',
  walkway: '#a3a8b0',
  walkwayLine: '#8e939b',
  boardFrame: 0x8fa3b8,
  boardFrameDark: 0x6b7f96,
  boardPanel: '#1b2433',
  boardPanelEdge: '#0e141e',
  boardHeading: '#ffffff',
  boardStripe: 'rgba(255,255,255,0.05)',
  boardInk: '#0b1018',
  boardName: '#ffffff',
  boardValue: '#9fe8ff',
  stallAwningA: 0x3a8bff,
  stallAwningB: 0xf5f7fb,
  stallWood: 0x8a5a2b,
} as const;

/** Distance fog. The staircase is thousands of units long, so it starts far out. */
export const WORLD_FOG = { near: 260, far: 1400 } as const;

