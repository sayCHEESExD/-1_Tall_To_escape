import {
  GUEST_NAME,
  MessageType,
  STAIRS,
  STAIR_START_Z,
  STEPS,
  TRAIL_TIERS,
  bestOwnedFood,
  encodeAvatarLook,
  formatNumber,
  petById,
  type PetHatchedMessage,
  type WinAwardedMessage,
} from '@highjump/shared';
import { AudioManager } from '../audio/AudioManager.js';
import { PlayerAudio } from '../audio/PlayerAudio.js';
import { Bloxity } from '../bloxity/Bloxity.js';
import { BloxityAvatar } from '../bloxity/BloxityAvatar.js';
import { toAvatarSlots, type LegionEquipped, type LegionProportions } from '../bloxity/legionTypes.js';
import { ThirdPersonCamera } from '../camera/ThirdPersonCamera.js';
import { clientConfig } from '../config/clientConfig.js';
import { InputManager } from '../input/InputManager.js';
import { NetworkClient } from '../net/NetworkClient.js';
import type { ConnectionStatus, IdentityPayload, NetPlayerState } from '../net/netTypes.js';
import { LocalPlayer } from '../player/LocalPlayer.js';
import { playerModelLoader } from '../player/PlayerModelLoader.js';
import { RemotePlayerManager } from '../player/RemotePlayerManager.js';
import { RunController } from '../progression/RunController.js';
import { LandingDebris } from '../rendering/LandingDebris.js';
import { RendererManager } from '../rendering/RendererManager.js';
import { SceneManager } from '../rendering/SceneManager.js';
import { TrophyBurst } from '../rendering/TrophyBurst.js';
import { BloxityPanel } from '../ui/BloxityPanel.js';
import { CosmeticPanel } from '../ui/CosmeticPanel.js';
import { EggShopPanel } from '../ui/EggShopPanel.js';
import { FoodHud } from '../ui/FoodHud.js';
import { FoodPopups } from '../ui/FoodPopups.js';
import { ICONS, injectHudStyles } from '../ui/hudStyles.js';
import { KeyHints, WinBanner } from '../ui/Overlays.js';
import { Panel, anyPanelOpen } from '../ui/Panel.js';
import { PetsPanel } from '../ui/PetsPanel.js';
import { RailButton } from '../ui/RailButton.js';
import { RebirthPanel } from '../ui/RebirthPanel.js';
import { WinsCounter } from '../ui/WinsCounter.js';
import { logger } from '../util/logger.js';
import { CourseWorld } from '../world/CourseWorld.js';
import { Shopkeeper } from '../world/Shopkeeper.js';

const SCOPE = 'Game';

/**
 * Milliseconds after our own join during which a remote player counts as
 * already HERE rather than arriving - Bloxity's "friend is in this room" versus
 * "friend just joined" toasts.
 */
const IN_ROOM_WINDOW_MS = 3000;

/** `code` first, `key` as the fallback for keystrokes that carry no code. */
const shortcutOf = (event: KeyboardEvent): string => {
  const code = event.code;
  if (code.startsWith('Key') && code.length === 4) return code.slice(3).toLowerCase();
  if (code) return code.toLowerCase();
  return (event.key || '').toLowerCase();
};

const isTyping = (target: EventTarget | null): boolean => {
  const element = target as HTMLElement | null;
  if (!element) return false;
  return element.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(element.tagName);
};

/** The recommended level of the first step above this level, or 0 past the top. Informational only. */
const nextStepLevel = (level: number): number =>
  STEPS.find((step) => step.recommendedLevel > level)?.recommendedLevel ?? 0;

/**
 * Composition root. Owns every subsystem and the per-frame order - input,
 * prediction, triggers, respawn, camera, network, render - and holds no
 * gameplay rules of its own.
 */
export class Game {
  private readonly renderer: RendererManager;
  private readonly sceneManager = new SceneManager();
  private readonly camera = new ThirdPersonCamera();
  private readonly input = new InputManager();
  private readonly world = new CourseWorld();
  private readonly remotePlayers: RemotePlayerManager;
  private readonly audio = new AudioManager();
  private readonly playerAudio: PlayerAudio;
  private readonly network: NetworkClient;
  private readonly run: RunController;
  /** The local player's landing rubble. Presentation only, never replicated. */
  private readonly debris = new LandingDebris();
  /** The shopkeeper NPC. Built once the player model has loaded. */
  private shopkeeper: Shopkeeper | null = null;

  private readonly hud: FoodHud;
  private readonly pops: FoodPopups;
  private readonly wins: WinsCounter;
  /** Trophies popping around the local player when they collect a win. */
  private readonly trophyBurst = new TrophyBurst();
  private readonly banner: WinBanner;
  private readonly keys: KeyHints;
  private readonly rail: HTMLDivElement;

  private readonly rebirthPanel: RebirthPanel;
  private readonly trailPanel: CosmeticPanel;
  private readonly petsPanel: PetsPanel;
  private readonly eggPanel: EggShopPanel;
  private readonly panels: Panel[];

  private readonly rebirthButton: RailButton;
  private readonly trailButton: RailButton;
  private readonly petsButton: RailButton;
  private readonly audioButton: RailButton;

  private localPlayer: LocalPlayer | null = null;
  private localSessionId: string | null = null;
  private localState: NetPlayerState | null = null;
  private lastLevel = -1;
  private lastRebirths = -1;
  private lastPurchases = '';
  private nextLevel = 0;
  /** The Egg Shop was closed by hand while standing at it; do not reopen until they leave. */
  private shopDismissed = false;

  /** The Bloxity bridge. The only thing in the client that talks to the SDK. */
  private readonly bloxity: Bloxity;
  private readonly bloxityPanel: BloxityPanel;
  /** Bloxity cosmetics on the local character. Built once the model exists. */
  private bloxityAvatar: BloxityAvatar | null = null;
  /** The latest look, held until the character is built. */
  private pendingLook: { equipped: LegionEquipped; proportions: LegionProportions } | null = null;
  /** Remote players already announced to Bloxity, so a name is toasted once. */
  private readonly announced = new Set<string>();
  /** The identity last sent to the room, so a login and its avatar push send it once. */
  private lastIdentity = '';
  private joinedAt = 0;
  /** FPS readout for the portal's `show_fps` setting. */
  private readonly fpsReadout: HTMLDivElement;
  private fpsFrames = 0;
  private fpsTime = 0;

  constructor(container: HTMLElement) {
    injectHudStyles();
    this.renderer = new RendererManager(container);
    this.remotePlayers = new RemotePlayerManager(this.sceneManager.scene);
    this.playerAudio = new PlayerAudio(this.audio);

    this.hud = new FoodHud(container);
    this.pops = new FoodPopups(container);
    this.wins = new WinsCounter(container);
    this.banner = new WinBanner(container);
    this.keys = new KeyHints(container);

    this.network = new NetworkClient({
      onStatusChange: (status) => this.onStatusChange(status),
      onSelfJoined: (sessionId) => {
        this.localSessionId = sessionId;
        this.joinedAt = performance.now();
        // Published as soon as the room is joinable, so an invite lands the
        // friend in THIS room rather than merely in the game.
        const roomId = this.network.roomId;
        this.bloxity.updateRoom(roomId);
        this.bloxityPanel.setRoom(roomId);
      },
      onPlayerAdded: (sessionId, state) => this.onPlayerState(sessionId, state, true),
      onPlayerChanged: (sessionId, state) => this.onPlayerState(sessionId, state, false),
      onPlayerRemoved: (sessionId) => {
        this.announced.delete(sessionId);
        this.remotePlayers.remove(sessionId);
      },
      // Placed at spawn immediately - there is no death animation to wait for.
      // Every placement starts a new attempt, so every pad can pay once again.
      onRespawn: (message) => {
        this.localPlayer?.teleport(message.x, message.y, message.z, message.rotationY);
        this.run.startAttempt();
      },
      onWinAwarded: (message) => this.onWinAwarded(message),
      onPetHatched: (message) => this.onPetHatched(message),
    });

    this.fpsReadout = document.createElement('div');
    this.fpsReadout.className = 'hj-fps hj-font';
    this.fpsReadout.hidden = true;
    container.appendChild(this.fpsReadout);

    /*
     * The Bloxity bridge. Everything Bloxity can change about the game arrives
     * through these callbacks, and nothing else in the codebase imports the SDK.
     */
    this.bloxity = new Bloxity({
      setMasterVolume: (level) => this.audio.setMasterVolume(level),
      setMusicVolume: (level) => this.audio.setMusicVolume(level),
      setGraphicsQuality: (level) => this.renderer.setQuality(level),
      setShowFps: (show) => {
        this.fpsReadout.hidden = !show;
      },
      setCameraSensitivity: (scale) => this.input.look.setSensitivityScale(scale),
      // The portal asks; the SERVER still decides where anyone is placed.
      respawn: () => this.network.requestRespawn(),
      pointerLockChanged: (locked) => this.input.look.setCursorFree(!locked),
      avatarChanged: (equipped, proportions) => {
        if (this.bloxityAvatar) this.bloxityAvatar.apply(equipped, proportions);
        else this.pendingLook = { equipped, proportions };
        this.bloxityPanel.refreshAvatar();
        // A new look is a new avatar thumbnail for everyone else's name tag and board.
        this.syncIdentity();
      },
      // A login or logout after joining. Before joining this is a no-op and the
      // join itself carries the identity.
      identityChanged: () => this.syncIdentity(),
    });
    this.network.setIdentityProvider(() => this.identityPayload());
    this.bloxityPanel = new BloxityPanel(container, this.bloxity);

    this.rebirthPanel = new RebirthPanel(container, () => this.network.requestRebirth());
    this.trailPanel = new CosmeticPanel(container, {
      variant: 'trail',
      title: 'Trail',
      icon: ICONS.trail,
      multiplierIcon: ICONS.food,
      rows: TRAIL_TIERS,
      onBuy: (slot) => this.network.sendSlot(MessageType.BuyTrail, slot),
      onEquip: (slot) => this.network.sendSlot(MessageType.EquipTrail, slot),
    });
    this.petsPanel = new PetsPanel(container, {
      equipBest: () => this.network.sendEmpty(MessageType.EquipBestPets),
      equipAll: () => this.network.sendEmpty(MessageType.EquipAllPets),
      toggle: (index) => this.network.sendIndex(MessageType.TogglePet, index),
      remove: (index) => this.network.sendIndex(MessageType.DeletePet, index),
    });
    this.eggPanel = new EggShopPanel(container, (slot) => {
      this.flushInput();
      this.network.sendSlot(MessageType.HatchEgg, slot);
    });
    this.eggPanel.onClose(() => {
      if (this.run.atHatchery) this.shopDismissed = true;
    });
    this.panels = [this.rebirthPanel, this.trailPanel, this.petsPanel, this.eggPanel];

    this.rail = document.createElement('div');
    this.rail.className = 'hj-rail';
    container.appendChild(this.rail);
    const tile = (variant: string, label: string, icon: string, hotkey: string, onClick: () => void): RailButton =>
      new RailButton(this.rail, { variant, label, icon, hotkey, onClick });
    this.rebirthButton = tile('rebirth', 'Rebirth', ICONS.rebirth, 'R', () => this.openOnly(this.rebirthPanel));
    this.trailButton = tile('trail', 'Trail', ICONS.trail, 'T', () => this.openOnly(this.trailPanel));
    this.petsButton = tile('pets', 'Pets', ICONS.pets, 'P', () => this.openOnly(this.petsPanel));
    this.audioButton = tile('audio', 'Mute', ICONS.audio, 'M', () => {
      const muted = this.audio.toggleMuted();
      this.audioButton.root.classList.toggle('hj-tile--off', muted);
      if (!muted) this.audio.play('ui');
    });
    this.audioButton.root.classList.toggle('hj-tile--off', this.audio.isMuted);

    this.run = new RunController(this.world.collision, {
      claimWin: (step) => {
        // The server validates against the last position it SIMULATED.
        this.flushInput();
        this.network.claimWin(step);
      },
      buyFood: (slot) => {
        this.flushInput();
        this.network.sendSlot(MessageType.BuyFood, slot);
      },
      enterHatchery: () => {
        if (!this.shopDismissed && !anyPanelOpen()) {
          this.eggPanel.setOpen(true);
          this.audio.play('ui');
        }
      },
      leaveHatchery: () => {
        this.shopDismissed = false;
        this.eggPanel.setOpen(false);
      },
    });

    window.addEventListener('keydown', this.onHotkey);
    window.addEventListener('keydown', this.onGesture);
    window.addEventListener('mousedown', this.onGesture);
    window.addEventListener('touchstart', this.onGesture, { passive: true });
    this.renderer.onResize((width, height) => this.camera.setViewport(width, height));
    this.renderer.renderer.domElement.addEventListener('wheel', this.onWheel, { passive: false });
  }

  /**
   * Mouse-wheel zoom: up zooms in, down zooms out. Bound to the canvas, so a
   * wheel over a scrolling panel scrolls the panel instead.
   */
  private readonly onWheel = (event: WheelEvent): void => {
    if (anyPanelOpen()) return;
    event.preventDefault();
    // Line- and page-mode wheels report in rows; convert to pixels.
    const scale = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? 400 : 1;
    this.camera.addZoom(event.deltaY * scale);
  };

  async initialise(): Promise<void> {
    this.sceneManager.scene.add(this.world.root, this.debris.root, this.trophyBurst.root);
    await playerModelLoader.load();
    this.shopkeeper = new Shopkeeper();
    this.sceneManager.scene.add(this.shopkeeper.root);
    this.localPlayer = new LocalPlayer(this.world.collision);
    this.sceneManager.scene.add(this.localPlayer.character.root, this.localPlayer.character.worldRoot);
    // Bloxity cosmetics on the LOCAL character, with any look that arrived while
    // the model was still loading.
    this.bloxityAvatar = new BloxityAvatar(this.localPlayer.character);
    if (this.pendingLook) {
      this.bloxityAvatar.apply(this.pendingLook.equipped, this.pendingLook.proportions);
      this.pendingLook = null;
    }
    this.camera.snapTo(this.localPlayer.position);
    logger.info(SCOPE, 'world ready');
  }

  async connect(): Promise<void> {
    await this.network.connect();
  }

  /** Initialise Bloxity. Called before anything loads, so the portal's loading screen is listening. */
  startBloxity(): void {
    this.bloxity.start();
  }

  /** Progress, for the portal's loading screen. */
  loadingStep(text: string): void {
    this.bloxity.loadingStep(text);
  }

  start(): void {
    this.input.attach(this.renderer.renderer.domElement);
    // The loading screen comes down and the session begins.
    this.bloxity.loadingEnd();
    this.bloxity.gameplayStart();
  }

  update(delta: number): void {
    this.fpsFrames += 1;
    this.fpsTime += delta;
    if (this.fpsTime >= 0.5) {
      if (!this.fpsReadout.hidden) this.fpsReadout.textContent = `${Math.round(this.fpsFrames / this.fpsTime)} FPS`;
      this.fpsFrames = 0;
      this.fpsTime = 0;
    }
    this.input.setSuppressed(anyPanelOpen());
    const input = this.input.sample();
    const player = this.localPlayer;
    this.camera.setOrbit(this.input.look.yaw, this.input.look.pitch);

    if (player) {
      player.update(delta, input, this.input.look.yaw);
      // No jumping on the map: hide the touch jump button there.
      document.body.classList.toggle('hj-no-jump', !player.canJump);
      if (player.jumped) this.playerAudio.jumped();
      // Landing impact: rubble, dust and a short shake, together on the frame
      // of touchdown. Local only; the sound is played by PlayerAudio below.
      const impact = player.landingImpact;
      if (impact > 0) {
        this.debris.burst(player.position.x, player.position.y, player.position.z, impact);
        this.camera.shake(impact);
      }
      this.run.update(delta, player);

      if (player.consumeRespawnNudge()) this.network.requestRespawn();

      const placement = player.consumePlacement();
      if (placement !== 'none') this.camera.snapTo(player.position, placement === 'respawn');
      this.camera.setTarget(player.position);
      // The legs drawn right now: the camera and the fog pull back with them.
      this.camera.setLegExtra(player.legExtra);
      // Between the staircase walls, the camera stays between them too.
      this.camera.setCorridor(player.position.z >= STAIR_START_Z - 2 ? STAIRS.width / 2 - 1.5 : 0);
      this.sceneManager.setLegExtra(player.legExtra);
      this.sceneManager.followShadow(player.position.x, player.position.y, player.position.z);
      this.flushInput();
      this.playerAudio.update(delta, player);

      const state = this.localState;
      if (state) {
        this.hud.update(state.level, state.food, state.rebirths, state.height, state.foodPerStep, this.nextLevel);
        this.eggPanel.sync(state.wins, state.pets, this.run.atHatchery);
      }
    }

    this.world.scoreboard.update(this.network.leaderboard);
    this.pops.update(delta);
    this.debris.update(delta);
    this.trophyBurst.update(delta, this.localPlayer?.position ?? null);
    this.shopkeeper?.update(delta, this.localPlayer?.position ?? null);
    this.remotePlayers.advance(delta);
    this.camera.update(delta, player?.horizontalSpeed ?? 0);
    const eye = this.camera.camera.position;
    this.world.update(delta, eye.x, eye.y, eye.z);
    this.renderer.renderer.render(this.sceneManager.scene, this.camera.camera);
  }

  private readonly onHotkey = (event: KeyboardEvent): void => {
    if (event.ctrlKey || event.metaKey || event.altKey || event.repeat || isTyping(event.target)) return;
    switch (shortcutOf(event)) {
      case 'r':
        this.rebirthButton.press();
        break;
      case 't':
        this.trailButton.press();
        break;
      case 'p':
        this.petsButton.press();
        break;
      case 'm':
        this.audioButton.press();
        break;
      case 'escape':
        for (const panel of this.panels) panel.setOpen(false);
        this.bloxityPanel.closeAll();
        this.input.look.setCursorFree(true);
        // Embedded, the portal owns the pause menu; standalone there is none.
        if (this.bloxity.embedded) this.bloxity.showPortalMenu(true);
        break;
      default:
        break;
    }
  };

  private readonly onGesture = (): void => {
    this.audio.resume();
  };

  private openOnly(panel: Panel): void {
    for (const other of this.panels) if (other !== panel) other.setOpen(false);
    this.bloxityPanel.closeAll();
    panel.toggle();
    this.audio.play('ui');
  }

  private flushInput(): void {
    const player = this.localPlayer;
    if (!player) return;
    for (const message of player.drainOutgoing()) this.network.sendInput(message);
  }

  private onPlayerState(sessionId: string, state: NetPlayerState, added: boolean): void {
    if (sessionId === this.localSessionId) {
      this.applyLocalState(state);
      return;
    }
    if (added) this.remotePlayers.add(sessionId, state);
    else this.remotePlayers.update(sessionId, state);
    // A verified name arrives a moment after the player does.
    this.announce(sessionId, state);
  }

  /**
   * Tell Bloxity who is here, once per player, by their Bloxity name. A
   * nameless "Guest" is not announced - there is nobody for the portal to match
   * against the friends list.
   */
  private announce(sessionId: string, state: NetPlayerState): void {
    if (!state.displayName || state.displayName === GUEST_NAME || this.announced.has(sessionId)) return;
    this.announced.add(sessionId);
    if (performance.now() - this.joinedAt < IN_ROOM_WINDOW_MS) this.bloxity.playerInRoom(state.displayName);
    else this.bloxity.playerJoined(state.displayName);
  }

  /**
   * Who this client is, from Bloxity: the token of a signed-in account (the
   * server verifies it against this game's slug and takes the account's name
   * and thumbnail from Bloxity), or else a guest - shown as "Guest", never by
   * Bloxity's random guest name - with the guest avatar Bloxity built for them.
   */
  private identityPayload(): IdentityPayload {
    // The avatar goes with it: everyone else draws this player from it, and ''
    // (no SDK at all) is the only thing that leaves them in the bundled body.
    const look = this.bloxity.available
      ? encodeAvatarLook(toAvatarSlots(this.bloxity.getEquipped()), this.bloxity.getProportions())
      : '';
    // The SDK's own user is the name everyone sees. The token goes with it and
    // the server prefers what it can verify - but the portal hands an embedded
    // game its user object whether or not it hands it a token, and a signed-in
    // player must never show as "Guest" for want of one. A guest reports no
    // name (only their picture), which is what makes them show as "Guest".
    const user = this.bloxity.getUser();
    const guest = user ? null : this.bloxity.getGuest();
    return {
      token: this.bloxity.getToken(),
      name: user ? user.displayName || user.username || '' : '',
      avatarUrl: user?.pfp || guest?.pfp || '',
      look,
    };
  }

  /** Send the identity to the room when it actually changed. */
  private syncIdentity(): void {
    const identity = this.identityPayload();
    const key = JSON.stringify(identity);
    if (key === this.lastIdentity) return;
    this.lastIdentity = key;
    this.network.sendIdentity(identity);
  }

  /** Everything the server says about us. Rendered, reconciled, never derived. */
  private applyLocalState(state: NetPlayerState): void {
    const player = this.localPlayer;
    if (!player) return;
    this.localState = state;

    // Our own name tag shows exactly what everyone else sees: the server's.
    player.character.setIdentity(state.displayName, state.avatarUrl);

    player.setProgression(state.jumpVelocity, state.gravity, state.rebirths, state.legReach);
    player.character.setCosmetics(state.trailSlot);
    player.character.setFood(bestOwnedFood(state.ownedFoods).slot);
    player.character.setPets(state.pets);
    if (state.ready) {
      player.reconcile({
        x: state.x,
        y: state.y,
        z: state.z,
        rotationY: state.rotationY,
        velocityX: state.velocityX,
        velocityY: state.velocityY,
        velocityZ: state.velocityZ,
        grounded: state.grounded,
        jumpCount: state.jumpCount,
        lastInputSeq: state.lastInputSeq,
        jumpLatched: state.jumpLatched,
        coyote: state.coyote,
      });
    }

    this.pops.observe(state.lifetimeFood);
    this.wins.update(state.wins);
    this.run.setInventory(state.ownedFoods, state.wins);

    if (this.lastLevel >= 0 && state.level > this.lastLevel) this.audio.play('level');
    if (this.lastRebirths >= 0 && state.rebirths > this.lastRebirths) this.audio.play('rebirth');
    if (state.level !== this.lastLevel) this.nextLevel = nextStepLevel(state.level);
    this.lastLevel = state.level;
    this.lastRebirths = state.rebirths;

    const purchases = `${state.ownedFoods}|${state.ownedTrails}`;
    if (this.lastPurchases && purchases !== this.lastPurchases) this.audio.play('buy');
    this.lastPurchases = purchases;

    this.rebirthPanel.setProgress(state.level, state.rebirths);
    this.rebirthButton.setState(this.rebirthPanel.isEligible);
    this.trailPanel.setInventory(state.ownedTrails, state.trailSlot, state.wins);
    this.trailButton.setState(this.trailPanel.hasAffordable);
    this.petsPanel.setInventory(state.pets, state.ownedFoods);
    this.world.foodShop.setInventory(state.ownedFoods, state.wins);
    this.world.dining.setRebirths(state.rebirths);
  }

  private onWinAwarded(message: WinAwardedMessage): void {
    this.wins.update(message.total);
    this.audio.play('win');
    this.banner.show(`+${formatNumber(message.wins)} WINS!`);
    this.trophyBurst.play();
  }

  private onPetHatched(message: PetHatchedMessage): void {
    const pet = petById(message.pet);
    if (!pet) return;
    this.audio.play('hatch');
    this.banner.show(`${pet.rarity.toUpperCase()} ${pet.name.toUpperCase()}!`);
  }

  private onStatusChange(status: ConnectionStatus): void {
    if (clientConfig.debug) logger.info(SCOPE, `connection: ${status}`);
  }

  dispose(): void {
    this.bloxity.gameplayEnd();
    // Out of the room, so a friend is not invited into a game nobody is in.
    this.bloxity.updateRoom('');
    this.input.detach();
    void this.network.disconnect();
    this.renderer.renderer.domElement.removeEventListener('wheel', this.onWheel);
    window.removeEventListener('keydown', this.onHotkey);
    window.removeEventListener('keydown', this.onGesture);
    window.removeEventListener('mousedown', this.onGesture);
    window.removeEventListener('touchstart', this.onGesture);
    for (const panel of this.panels) panel.dispose();
    for (const button of [this.rebirthButton, this.trailButton, this.petsButton, this.audioButton]) {
      button.dispose();
    }
    this.hud.dispose();
    this.pops.dispose();
    this.wins.dispose();
    this.trophyBurst.dispose();
    this.banner.dispose();
    this.keys.dispose();
    this.rail.remove();
    this.audio.dispose();
    this.remotePlayers.dispose();
    this.debris.dispose();
    this.shopkeeper?.dispose();
    this.bloxityPanel.dispose();
    this.bloxityAvatar?.dispose();
    this.bloxity.dispose();
    this.fpsReadout.remove();
    this.world.dispose();
    this.renderer.dispose();
  }
}
