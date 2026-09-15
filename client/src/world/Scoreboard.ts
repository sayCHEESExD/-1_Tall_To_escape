import { LEADERBOARD_SIZE, SCOREBOARD, formatDuration, formatNumber } from '@highjump/shared';
import {
  CanvasTexture,
  FrontSide,
  Group,
  LinearFilter,
  Mesh,
  MeshBasicMaterial,
  MeshLambertMaterial,
  PlaneGeometry,
  SRGBColorSpace,
  type BufferGeometry,
} from 'three';
import { PALETTE } from '../config/worldVisuals.js';
import type { LeaderboardSnapshot, NetLeaderEntry } from '../net/netTypes.js';
import { avatarNow, drawAvatar, loadAvatar } from '../ui/avatarImages.js';
import { CanvasSign } from './CanvasSign.js';
import { texturedBox } from './texturedBox.js';

type Category = 'wins' | 'height' | 'time';

interface BoardSpec {
  readonly category: Category;
  readonly title: string;
  readonly frame: number;
  readonly titleStroke: string;
}

/** Most Wins (cyan), Most Height (green), Most Time (pink). */
const BOARDS: readonly BoardSpec[] = [
  { category: 'wins', title: 'Most Wins', frame: 0x39e0ff, titleStroke: '#0d4a72' },
  { category: 'height', title: 'Most Height', frame: 0x39d65a, titleStroke: '#0f5a1f' },
  { category: 'time', title: 'Most Time', frame: 0xff8ee8, titleStroke: '#6a1060' },
];

const BOARD = { width: 20, height: 22, frame: 2, depth: 2, baseY: 2 } as const;
const PIXELS_PER_UNIT = 44;
const RANK_COLOURS = ['#ffd53d', '#dfe6ef', '#ff9a3d'] as const;
const FONT = '"Arial Black", "Segoe UI", system-ui, sans-serif';

/**
 * The three leaderboards against the hub's RIGHT wall, facing into the hub.
 * World-space: a thing you walk up to and read. Every figure is the server's;
 * each row is [rank] [Bloxity avatar] Display Name, value. A panel redraws only
 * when its standings change or an avatar thumbnail finishes loading.
 */
export class Scoreboard {
  readonly root = new Group();
  private readonly panels: PanelSurface[] = [];
  private readonly signs: CanvasSign[] = [];
  private readonly geometries: BufferGeometry[] = [];
  private readonly materials: (MeshLambertMaterial | MeshBasicMaterial)[] = [];

  constructor() {
    BOARDS.forEach((spec, index) => {
      const group = new Group();
      group.position.set(SCOREBOARD.x, 0, SCOREBOARD.zs[index] ?? 0);
      // The panel's front is local +Z; turned to face +X, into the hub.
      group.rotation.y = Math.PI / 2;

      const frame = new MeshLambertMaterial({ color: spec.frame, emissive: spec.frame, emissiveIntensity: 0.15 });
      this.materials.push(frame);
      const midY = BOARD.baseY + BOARD.height / 2;
      const outerW = BOARD.width + BOARD.frame * 2;
      const bars: [number, number, number, number][] = [
        [0, midY + BOARD.height / 2 + BOARD.frame / 2, outerW, BOARD.frame],
        [0, midY - BOARD.height / 2 - BOARD.frame / 2, outerW, BOARD.frame],
        [-BOARD.width / 2 - BOARD.frame / 2, midY, BOARD.frame, BOARD.height],
        [BOARD.width / 2 + BOARD.frame / 2, midY, BOARD.frame, BOARD.height],
      ];
      for (const [bx, by, bw, bh] of bars) {
        const geometry = texturedBox(bw, bh, BOARD.depth, 2);
        this.geometries.push(geometry);
        const bar = new Mesh(geometry, frame);
        bar.position.set(bx, by, 0);
        bar.castShadow = true;
        group.add(bar);
      }

      const surface = new PanelSurface(spec, BOARD.width, BOARD.height);
      surface.mesh.position.set(0, midY, BOARD.depth / 2 + 0.02);
      group.add(surface.mesh);
      this.panels.push(surface);

      const title = new CanvasSign(outerW, 5, [
        { text: spec.title, size: 1, fill: '#ffffff', stroke: spec.titleStroke, strokeWidth: 0.2 },
      ]);
      title.mesh.position.set(0, midY + BOARD.height / 2 + BOARD.frame + 3, BOARD.depth / 2 + 0.3);
      group.add(title.mesh);
      this.signs.push(title);

      this.root.add(group);
    });
  }

  update(board: LeaderboardSnapshot | null): void {
    if (!board) return;
    for (const panel of this.panels) panel.apply(board[panel.category]);
  }

  dispose(): void {
    for (const panel of this.panels) panel.dispose();
    for (const sign of this.signs) sign.dispose();
    for (const geometry of this.geometries) geometry.dispose();
    for (const material of this.materials) material.dispose();
    this.root.removeFromParent();
  }
}

class PanelSurface {
  readonly mesh: Mesh;
  readonly category: Category;
  private readonly canvas = document.createElement('canvas');
  private readonly texture: CanvasTexture;
  private readonly material: MeshBasicMaterial;
  private readonly geometry: PlaneGeometry;
  private signature = '-';
  private rows: readonly NetLeaderEntry[] = [];
  private disposed = false;

  constructor(private readonly spec: BoardSpec, width: number, height: number) {
    this.category = spec.category;
    this.canvas.width = Math.round(width * PIXELS_PER_UNIT);
    this.canvas.height = Math.round(height * PIXELS_PER_UNIT);
    this.texture = new CanvasTexture(this.canvas);
    this.texture.colorSpace = SRGBColorSpace;
    this.texture.generateMipmaps = false;
    this.texture.minFilter = LinearFilter;
    this.geometry = new PlaneGeometry(width, height);
    this.material = new MeshBasicMaterial({ map: this.texture, side: FrontSide });
    this.mesh = new Mesh(this.geometry, this.material);
    this.apply([]);
  }

  apply(rows: readonly NetLeaderEntry[]): void {
    const signature = rows.map((row) => `${row.name}:${row.avatarUrl}:${row.value}`).join('|');
    if (signature === this.signature) return;
    this.signature = signature;
    this.rows = rows;
    this.draw(rows);
    this.texture.needsUpdate = true;
  }

  dispose(): void {
    this.disposed = true;
    this.texture.dispose();
    this.material.dispose();
    this.geometry.dispose();
  }

  private draw(rows: readonly NetLeaderEntry[]): void {
    const ctx = this.canvas.getContext('2d');
    if (!ctx) return;
    const { width, height } = this.canvas;
    ctx.fillStyle = PALETTE.boardPanel;
    ctx.fillRect(0, 0, width, height);
    const pad = width * 0.05;
    const rowH = (height - pad * 2) / LEADERBOARD_SIZE;
    ctx.textBaseline = 'middle';
    ctx.lineJoin = 'round';

    if (!rows.some((row) => row.name)) {
      ctx.textAlign = 'center';
      ctx.fillStyle = '#9fb3c8';
      ctx.font = `900 ${rowH * 0.5}px ${FONT}`;
      ctx.fillText('No scores yet', width / 2, height / 2);
      return;
    }

    for (let i = 0; i < LEADERBOARD_SIZE; i += 1) {
      const row = rows[i];
      const y = pad + rowH * (i + 0.5);
      if (i % 2 === 1) {
        ctx.fillStyle = PALETTE.boardStripe;
        ctx.fillRect(pad * 0.5, pad + rowH * i, width - pad, rowH);
      }
      if (!row || !row.name) continue;
      const size = rowH * 0.5;

      ctx.textAlign = 'left';
      ctx.font = `900 ${size}px ${FONT}`;
      ctx.fillStyle = RANK_COLOURS[i] ?? '#ffffff';
      ctx.fillText(`#${i + 1}`, pad, y);

      const value = this.format(row.value);
      ctx.textAlign = 'right';
      fit(ctx, value, width * 0.3, size);
      ctx.fillStyle = PALETTE.boardValue;
      ctx.fillText(value, width - pad, y);

      // [Bloxity avatar] Display Name
      const radius = rowH * 0.36;
      const avatarX = pad + width * 0.13 + radius;
      this.ensureAvatar(row.avatarUrl);
      drawAvatar(ctx, avatarNow(row.avatarUrl), avatarX, y, radius, RANK_COLOURS[i] ?? '#ffffff');

      const nameX = avatarX + radius + width * 0.02;
      ctx.textAlign = 'left';
      fit(ctx, row.name, width * 0.7 - nameX, size);
      ctx.fillStyle = PALETTE.boardName;
      ctx.fillText(row.name, nameX, y);
    }
  }

  /** Repaint once a row's thumbnail arrives. Each URL loads once, shared with the name tags. */
  private ensureAvatar(url: string): void {
    if (avatarNow(url) !== undefined) return;
    void loadAvatar(url).then(() => {
      if (this.disposed) return;
      this.draw(this.rows);
      this.texture.needsUpdate = true;
    });
  }

  private format(value: number): string {
    if (this.spec.category === 'time') return formatDuration(value);
    return formatNumber(value);
  }
}

/** Shrink a font until the text fits its column. */
const fit = (ctx: CanvasRenderingContext2D, text: string, room: number, preferred: number): void => {
  let size = preferred;
  for (let pass = 0; pass < 4; pass += 1) {
    ctx.font = `900 ${size}px ${FONT}`;
    const drawn = ctx.measureText(text).width;
    if (drawn <= room) return;
    size *= room / drawn;
  }
  ctx.font = `900 ${size}px ${FONT}`;
};
