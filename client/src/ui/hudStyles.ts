/**
 * One stylesheet for the whole HUD, injected on first use, so the rail, the
 * counters and every panel share one look: heavy white display type with a
 * dark rim, saturated gradient tiles with chunky borders, studded plates.
 * (No backticks inside - the stylesheet is a template literal.)
 */
let injected = false;

export const injectHudStyles = (): void => {
  if (injected) return;
  injected = true;
  const style = document.createElement('style');
  style.textContent = `
:root { --hj-rail: 76px; --hj-ink: #12181f; }
.hj-font { font-family: "Arial Black", "Arial Bold", Arial, system-ui, sans-serif; }
.hj-outline {
  color: #fff;
  text-shadow:
    3px 0 0 var(--hj-ink), -3px 0 0 var(--hj-ink), 0 3px 0 var(--hj-ink), 0 -3px 0 var(--hj-ink),
    2px 2px 0 var(--hj-ink), -2px 2px 0 var(--hj-ink), 2px -2px 0 var(--hj-ink), -2px -2px 0 var(--hj-ink),
    0 5px 9px rgba(0, 0, 0, 0.45);
}
.hj-icon { pointer-events: none; }

/* ---- Wins, upper centre ---- */
.hj-wins {
  position: fixed; top: max(10px, env(safe-area-inset-top, 0px)); left: 50%;
  transform: translateX(-50%); display: flex; align-items: center; gap: 10px;
  pointer-events: none; user-select: none; z-index: 22;
}
.hj-wins__icon { width: clamp(34px, 3.8vw, 52px); height: clamp(34px, 3.8vw, 52px); }
.hj-wins__icon .hj-icon { width: 100%; height: 100%; object-fit: contain; filter: drop-shadow(0 4px 6px rgba(0,0,0,.45)); }
.hj-wins__value {
  font-size: clamp(24px, 3.2vw, 44px); line-height: 1; color: #ff9d1f;
  text-shadow: 3px 0 0 #fff, -3px 0 0 #fff, 0 3px 0 #fff, 0 -3px 0 #fff,
    2px 2px 0 #fff, -2px 2px 0 #fff, 2px -2px 0 #fff, -2px -2px 0 #fff, 0 6px 10px rgba(0,0,0,.5);
}
.hj-wins--pop .hj-wins__value { animation: hj-pop 520ms ease-out; }
@keyframes hj-pop { 0% { transform: scale(1); } 35% { transform: scale(1.22); } 100% { transform: scale(1); } }

/* ---- Left rail ---- */
.hj-rail {
  position: fixed; left: max(12px, env(safe-area-inset-left, 0px)); top: 50%;
  transform: translateY(-50%); display: grid; grid-template-columns: repeat(2, var(--hj-rail));
  gap: 16px 12px; z-index: 21; user-select: none;
}
.hj-tile {
  position: relative; width: var(--hj-rail); height: var(--hj-rail);
  border: 4px solid var(--hj-ink); border-radius: 18px; display: grid; place-items: center;
  cursor: pointer; padding: 0; color: #fff; box-shadow: 0 6px 12px rgba(0,0,0,.38);
  transition: transform 110ms ease;
}
.hj-tile:hover { transform: scale(1.06); }
.hj-tile:active { transform: scale(0.96); }
.hj-tile .hj-icon { width: 86%; height: 86%; object-fit: contain; filter: drop-shadow(0 3px 3px rgba(0,0,0,.35)); }
.hj-tile__label {
  position: absolute; left: 50%; bottom: -10px; transform: translateX(-50%);
  font-size: clamp(11px, 1.1vw, 15px); white-space: nowrap; pointer-events: none;
}
.hj-tile__key {
  position: absolute; left: -7px; top: -7px; min-width: 22px; height: 22px; padding: 0 4px;
  box-sizing: border-box; border: 3px solid var(--hj-ink); border-radius: 7px; background: #fff;
  color: var(--hj-ink); font-size: 12px; line-height: 16px; text-align: center; pointer-events: none;
}
body.hj-touch-mode .hj-tile__key { display: none; }
.hj-tile__badge {
  position: absolute; right: -8px; top: -8px; width: 24px; height: 24px; border: 3px solid var(--hj-ink);
  border-radius: 50%; background: #f5363f; color: #fff; font-size: 14px; line-height: 18px;
  text-align: center; display: none;
}
.hj-tile--ready .hj-tile__badge { display: block; }
.hj-tile--locked { filter: saturate(.5) brightness(.85); }
.hj-tile--rebirth { background: linear-gradient(160deg, #6de6ff, #2aa8f5 55%, #1670d0); }
.hj-tile--trail { background: linear-gradient(160deg, #ff8a5c, #f0463a 55%, #c21f2c); }
.hj-tile--pets { background: linear-gradient(160deg, #ffd76b, #ffa32b 55%, #d97708); }
.hj-tile--audio { background: linear-gradient(160deg, #9bf06a, #4fce2e 60%, #2f9a1f); }
.hj-tile--off { filter: saturate(.25) brightness(.7); }
.hj-tile svg.hj-icon { width: 62%; height: 62%; }

/* ---- Bottom: height, food per step, level bar ---- */
.hj-hud {
  position: fixed; left: 50%; bottom: max(3vh, env(safe-area-inset-bottom, 0px)); transform: translateX(-50%);
  width: min(760px, 70vw); pointer-events: none; user-select: none; z-index: 20;
}
.hj-hud__next { text-align: center; font-size: clamp(12px, 1.3vw, 17px); color: #ff9a3d; margin-bottom: 4px; white-space: nowrap; }
.hj-hud__next--open { color: #7dff5c; }
.hj-hud__row { display: flex; align-items: flex-end; justify-content: space-between; gap: 10px; margin: 0 14px 6px; }
.hj-hud__height { font-size: clamp(18px, 2.4vw, 32px); white-space: nowrap; }
.hj-hud__rate { font-size: clamp(13px, 1.5vw, 20px); color: #ffe14d; white-space: nowrap; }
.hj-hud__rebirth {
  font-size: clamp(13px, 1.6vw, 22px); color: #3fe6ff; white-space: nowrap;
  text-shadow: 2px 0 0 #0b3550, -2px 0 0 #0b3550, 0 2px 0 #0b3550, 0 -2px 0 #0b3550;
}
.hj-hud__bar {
  position: relative; height: clamp(34px, 4.4vw, 56px); border-radius: 12px; border: 4px solid var(--hj-ink);
  overflow: hidden; background-color: #515a66;
  background-image: linear-gradient(90deg, rgba(0,0,0,.12) 1px, transparent 1px), linear-gradient(0deg, rgba(0,0,0,.12) 1px, transparent 1px);
  background-size: 14px 14px; box-shadow: 0 5px 12px rgba(0,0,0,.4);
}
.hj-hud__fill {
  position: absolute; inset: 0 auto 0 0; width: 0%;
  background: linear-gradient(90deg, #ff5a1f 0%, #ff9d1f 45%, #ffe14d 100%);
  box-shadow: inset 0 -4px 0 rgba(0,0,0,.16); transition: width 130ms linear;
}
.hj-hud__level, .hj-hud__amount {
  position: absolute; top: 0; bottom: 0; display: flex; align-items: center; gap: 6px;
  font-size: clamp(15px, 1.9vw, 25px); white-space: nowrap;
}
.hj-hud__level { left: 16px; }
.hj-hud__amount { right: 16px; }
.hj-hud__amount img { height: 1.45em; width: auto; }
.hj-hud--levelup .hj-hud__bar { animation: hj-bar-pop 460ms ease-out; }
@keyframes hj-bar-pop { 0% { transform: scale(1); } 35% { transform: scale(1.03); } 100% { transform: scale(1); } }
body.hj-touch-mode .hj-hud { bottom: calc(3vh + 104px); width: min(560px, 60vw); }

/* ---- Key hints (desktop) ---- */
.hj-keys {
  position: fixed; right: max(14px, env(safe-area-inset-right, 0px)); top: max(104px, env(safe-area-inset-top, 0px)); z-index: 20; display: flex; flex-direction: column;
  gap: 6px; align-items: flex-end; pointer-events: none; font-size: 13px;
}
.hj-keys span { background: rgba(10,16,28,.55); color: #fff; border-radius: 9px; padding: 4px 9px; }
.hj-keys b { display: inline-block; min-width: 18px; padding: 0 5px; margin-right: 5px; border-radius: 5px; background: #fff; color: var(--hj-ink); text-align: center; }
body.hj-touch-mode .hj-keys { display: none; }

/* ---- Win banner ---- */
.hj-banner {
  position: fixed; top: 22%; left: 50%; transform: translateX(-50%); z-index: 25; pointer-events: none;
  font-size: clamp(28px, 5vw, 64px); color: #ffd23d; white-space: nowrap; opacity: 0;
}
.hj-banner--run { animation: hj-banner 1600ms ease-out forwards; }
@keyframes hj-banner {
  0% { opacity: 0; transform: translateX(-50%) scale(.6); }
  15% { opacity: 1; transform: translateX(-50%) scale(1.12); }
  25% { transform: translateX(-50%) scale(1); }
  80% { opacity: 1; }
  100% { opacity: 0; transform: translateX(-50%) translateY(-20px); }
}

/* ---- Food popups (below the HUD in stacking order) ---- */
.hj-pops { position: fixed; inset: 0; pointer-events: none; overflow: hidden; z-index: 19; }
.hj-pop { --hj-pop-tilt: 0deg; --hj-pop-scale: 1; position: absolute; display: flex; align-items: center; gap: 4px; opacity: 0; }
.hj-pop[hidden] { display: none; }
.hj-pop__icon { height: clamp(38px, 4.4vw, 62px); width: auto; filter: drop-shadow(0 3px 5px rgba(0,0,0,.45)); }
.hj-pop__value {
  font-size: clamp(16px, 2vw, 30px); line-height: 1; color: #ffe14d;
  text-shadow: 3px 0 0 var(--hj-ink), -3px 0 0 var(--hj-ink), 0 3px 0 var(--hj-ink), 0 -3px 0 var(--hj-ink),
    2px 2px 0 var(--hj-ink), -2px 2px 0 var(--hj-ink), 2px -2px 0 var(--hj-ink), -2px -2px 0 var(--hj-ink);
}
.hj-pop--run { animation: hj-pop-float 1150ms ease-out forwards; }
@keyframes hj-pop-float {
  0% { opacity: 0; transform: translate(-50%, -50%) rotate(var(--hj-pop-tilt)) scale(calc(var(--hj-pop-scale) * .6)); }
  16% { opacity: 1; transform: translate(-50%, -54%) rotate(var(--hj-pop-tilt)) scale(calc(var(--hj-pop-scale) * 1.1)); }
  30% { opacity: 1; transform: translate(-50%, -62%) rotate(var(--hj-pop-tilt)) scale(var(--hj-pop-scale)); }
  100% { opacity: 0; transform: translate(-50%, -125%) rotate(var(--hj-pop-tilt)) scale(var(--hj-pop-scale)); }
}

/* ---- Panels ---- */
.hj-panel { position: fixed; inset: 0; display: grid; place-items: center; background: rgba(6,10,18,.45); z-index: 40; }
.hj-panel[hidden] { display: none; }
.hj-panel__box {
  position: relative; width: min(600px, 92vw); max-height: 84vh; display: flex; flex-direction: column;
  border: 5px solid var(--hj-ink); border-radius: 22px; background-color: #ffffff;
  background-image: linear-gradient(90deg, rgba(0,0,0,.045) 2px, transparent 2px), linear-gradient(0deg, rgba(0,0,0,.045) 2px, transparent 2px);
  background-size: 22px 22px; box-shadow: 0 18px 40px rgba(0,0,0,.5);
}
.hj-panel__head { display: flex; align-items: center; gap: 10px; padding: 8px 60px 4px 18px; font-size: clamp(26px, 3.4vw, 44px); }
.hj-panel__head img, .hj-panel__head svg { height: 1.6em; width: 1.6em; object-fit: contain; flex: none; }
.hj-panel__close {
  position: absolute; right: -14px; top: -18px; width: 54px; height: 54px; border: none; background: none;
  font-size: 46px; line-height: 1; color: #f5363f; cursor: pointer;
  text-shadow: 3px 0 0 var(--hj-ink), -3px 0 0 var(--hj-ink), 0 3px 0 var(--hj-ink), 0 -3px 0 var(--hj-ink);
}
.hj-panel__body { padding: 8px 16px 18px; overflow-y: auto; color: #16202b; font-family: system-ui, "Segoe UI", Roboto, sans-serif; }

.hj-btn {
  border: 3px solid var(--hj-ink); border-radius: 12px; padding: 8px 14px; color: #fff; cursor: pointer;
  font-size: clamp(14px, 1.6vw, 20px); white-space: nowrap; box-shadow: inset 0 -4px 0 rgba(0,0,0,.2);
  display: inline-flex; align-items: center; justify-content: center; gap: 6px;
  text-shadow: 2px 0 0 var(--hj-ink), -2px 0 0 var(--hj-ink), 0 2px 0 var(--hj-ink), 0 -2px 0 var(--hj-ink);
}
.hj-btn img { height: 1.35em; width: auto; }
.hj-btn:disabled { filter: saturate(.3) brightness(.85); cursor: not-allowed; }
.hj-btn--wins { background: linear-gradient(180deg, #e676ff, #b44bff 60%, #8a2bd6); }
.hj-btn--gold { background: linear-gradient(180deg, #ffd76b, #ffa32b 55%, #e07f10); }
.hj-btn--green { background: linear-gradient(180deg, #9bf06a, #4fce2e 60%, #37a81f); }
.hj-btn--red { background: linear-gradient(180deg, #ff7a7a, #f5363f 60%, #c41c25); }
.hj-btn--blue { background: linear-gradient(180deg, #6de6ff, #2aa8f5 55%, #1670d0); }

/* Cosmetic rows (trails), as in the reference menus */
.hj-cos {
  display: grid; grid-template-columns: 70px 1fr auto; align-items: center; gap: 12px; padding: 10px 12px;
  margin-bottom: 12px; border: 4px solid var(--hj-ink); border-radius: 16px; color: #fff;
}
.hj-cos__swatch { width: 64px; height: 64px; border-radius: 50%; border: 3px solid rgba(0,0,0,.35); box-shadow: 0 0 18px var(--hj-glow, #fff); }
.hj-cos__name { font-size: clamp(18px, 2.2vw, 28px); }
.hj-cos__mult { font-size: clamp(14px, 1.5vw, 19px); color: #b8ff5c; display: flex; align-items: center; gap: 5px; }
.hj-cos__mult img { height: 1.45em; width: auto; }

/* Rebirth: purple header bar, Before/After height cards, level bar, Rebirth button */
.hj-panel--rebirth .hj-panel__box {
  width: min(560px, 94vw); border-radius: 6px; overflow: hidden;
  background-color: rgba(70, 58, 96, .9);
  background-image: linear-gradient(90deg, rgba(255,255,255,.05) 2px, transparent 2px), linear-gradient(0deg, rgba(255,255,255,.05) 2px, transparent 2px);
  background-size: 26px 26px;
}
.hj-panel--rebirth .hj-panel__head {
  padding: 10px 76px 10px 14px; border-bottom: 4px solid var(--hj-ink);
  background: linear-gradient(90deg, #9b2bff, #ff2bd6 55%, #b42bff); font-size: clamp(26px, 3.4vw, 36px);
}
.hj-panel--rebirth .hj-panel__close {
  right: 10px; top: 8px; width: 50px; height: 50px; border: 4px solid var(--hj-ink); border-radius: 6px;
  background: linear-gradient(180deg, #ff6a78, #d41c34); color: #fff; font-size: 28px;
}
.hj-panel--rebirth .hj-panel__body { padding: 12px 18px 20px; color: #fff; overflow-x: hidden; }
.hj-rb__cols { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: 14px; margin-bottom: 8px; }
.hj-rb__label { text-align: center; font-size: clamp(20px, 2.8vw, 30px); margin-bottom: 8px; }
.hj-rb__card {
  display: flex; align-items: center; justify-content: center; gap: 4px; padding: 12px 4px; min-width: 0;
  border: 4px solid var(--hj-ink); border-radius: 4px; white-space: nowrap; overflow: hidden;
  background: linear-gradient(135deg, #fff200, #ffb400 50%, #ffe000); font-size: clamp(16px, 2.4vw, 28px);
}
.hj-rb__arrow { width: 1.05em; height: 1.05em; flex: none; }
.hj-rb__warn { text-align: center; margin: 12px 0 8px; font-size: clamp(16px, 2.2vw, 24px); }
.hj-rb__warn.hj-outline { color: #ff3b3b; }
.hj-rb__bar {
  position: relative; height: clamp(46px, 7vw, 62px); border: 4px solid var(--hj-ink); border-radius: 4px;
  background: #1b3552; overflow: hidden; margin-bottom: 16px;
}
.hj-rb__fill { height: 100%; background: linear-gradient(90deg, #1f8cff, #1fd3ff 55%, #2ab6ff); }
.hj-rb__barlabel { position: absolute; inset: 0; display: grid; place-items: center; font-size: clamp(22px, 3.2vw, 34px); }
.hj-rb__actions { display: flex; justify-content: center; }
.hj-rb__actions .hj-rb__button { width: min(100%, 320px); }
.hj-rb__button {
  border: 4px solid var(--hj-ink); border-radius: 4px; padding: 14px 8px; cursor: pointer; white-space: nowrap;
  box-shadow: inset 0 -5px 0 rgba(0,0,0,.18);
}
.hj-rb__go { background: linear-gradient(135deg, #3dff3d, #b4ff00 50%, #2fd12f); font-size: clamp(24px, 3.6vw, 40px); }
.hj-rb__button:disabled { filter: saturate(.35) brightness(.8); cursor: not-allowed; }
.hj-rb__button.hj-outline { color: #fff; }
body.hj-no-jump .hj-touch__jump { display: none; }

/* Egg shop */
.hj-egg {
  display: grid; grid-template-columns: 74px 1fr auto; align-items: center; gap: 12px; padding: 10px 12px; margin-bottom: 12px;
  border: 4px solid var(--hj-ink); border-radius: 16px; color: #fff;
}
.hj-egg__shell { width: 58px; height: 74px; border-radius: 50% 50% 46% 46% / 60% 60% 40% 40%; border: 3px solid rgba(0,0,0,.35); box-shadow: inset 8px 10px 0 rgba(255,255,255,.35); }
.hj-egg__name { font-size: clamp(18px, 2.2vw, 26px); }
.hj-egg__pets { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 6px; margin-top: 6px; }
.hj-egg__pet { border: 2px solid var(--hj-ink); border-radius: 10px; padding: 3px 4px; text-align: center; font-size: 11px; line-height: 1.25; background: rgba(0,0,0,.28); }
.hj-egg__pet b { display: block; font-size: 12px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.hj-egg__pet i { font-style: normal; color: #fff36b; }
.hj-shop__note { text-align: center; margin-top: 10px; font-weight: 700; color: #43506b; }
.hj-shop__summary { text-align: center; margin: 0 0 10px; font-weight: 800; color: #43506b; }
.hj-card {
  display: flex; flex-direction: column; align-items: center; gap: 6px; padding: 8px 6px 10px;
  border: 3px solid var(--hj-ink); border-radius: 16px; color: #fff; text-align: center;
}
.hj-card__rarity { font-size: clamp(14px, 1.8vw, 22px); }
.hj-card__gem { width: 64px; height: 64px; transform: rotate(45deg); border: 4px solid rgba(0,0,0,.35); border-radius: 12px; margin: 10px 0; box-shadow: inset 8px 8px 0 rgba(255,255,255,.35); }
.hj-card__name { font-size: clamp(14px, 1.7vw, 20px); }
.hj-card__bonus { font-size: clamp(12px, 1.4vw, 17px); color: #fff36b; }
.hj-card__pet { width: 60px; height: 60px; border-radius: 50%; border: 4px solid rgba(0,0,0,.35); margin: 8px 0 4px; box-shadow: inset 8px 8px 0 rgba(255,255,255,.35); }
.hj-card__rarity--small { font-size: 12px; opacity: .95; }

/* Backpack */
.hj-bp__tabs { display: flex; gap: 8px; justify-content: center; margin-bottom: 10px; }
.hj-bp__empty { grid-column: 1 / -1; }
.hj-bp__tab { min-width: 104px; padding: 6px 8px; border: 3px solid var(--hj-ink); border-radius: 12px; background: linear-gradient(180deg, #6de6ff, #2aa8f5); color: #fff; cursor: pointer; font-size: 13px; display: flex; flex-direction: column; align-items: center; gap: 2px; }
.hj-bp__tab img { height: 44px; width: auto; }
.hj-bp__tab--on { background: linear-gradient(180deg, #ffe14d, #ffb31f); }
.hj-bp__frame { border: 4px solid var(--hj-ink); border-radius: 18px; padding: 10px; min-height: 240px; background: rgba(255,255,255,.7); }
.hj-bp__title { text-align: center; font-size: clamp(16px, 2vw, 24px); margin-bottom: 8px; }
.hj-bp__grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(140px, 1fr)); gap: 10px; }
.hj-bp__item { position: relative; cursor: pointer; }
.hj-bp__item--sel { outline: 4px solid #2aa8f5; outline-offset: 2px; }
.hj-bp__equipped { position: absolute; right: 6px; top: 6px; background: #4fce2e; border: 2px solid var(--hj-ink); border-radius: 8px; padding: 0 5px; font-size: 12px; }
.hj-bp__empty { text-align: center; color: #6b7280; margin-top: 60px; }
.hj-bp__actions { display: flex; justify-content: space-between; gap: 10px; margin-top: 12px; flex-wrap: wrap; }

/* ---- Bloxity account chip, top right (key hints sit below it) ---- */
.hj-account {
  position: fixed; top: max(12px, env(safe-area-inset-top, 0px)); right: max(12px, env(safe-area-inset-right, 0px));
  z-index: 23; display: flex; flex-direction: column; align-items: flex-end; gap: 6px;
}
.hj-account__row {
  display: flex; align-items: center; gap: 8px; padding: 4px 10px 4px 4px;
  border: 3px solid var(--hj-ink); border-radius: 999px; background: rgba(18, 24, 38, 0.82);
}
.hj-account__pfp { width: 30px; height: 30px; border-radius: 50%; border: 2px solid var(--hj-ink); object-fit: cover; }
.hj-account__name { font-size: clamp(12px, 1.2vw, 15px); color: #fff; max-width: 22vw; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.hj-account__note { font-size: clamp(10px, 1vw, 13px); color: #fff; opacity: .75; }
.hj-account__actions { display: flex; gap: 6px; flex-wrap: wrap; justify-content: flex-end; }
.hj-account__btn, .hj-account__login {
  cursor: pointer; border: 3px solid var(--hj-ink); border-radius: 10px; padding: 5px 10px;
  font-size: clamp(11px, 1.1vw, 14px); color: #fff; box-shadow: 0 3px 0 rgba(0,0,0,.3);
  background: linear-gradient(180deg, #6de6ff 0%, #2aa8f5 55%, #1670d0 100%);
  text-shadow: 1px 0 0 var(--hj-ink), -1px 0 0 var(--hj-ink), 0 1px 0 var(--hj-ink), 0 -1px 0 var(--hj-ink);
}
.hj-account__login { background: linear-gradient(180deg, #ffd76b 0%, #ffa32b 55%, #d97708 100%); padding: 7px 14px; }
.hj-account__btn:hover, .hj-account__login:hover { filter: brightness(1.1); }
body.hj-touch-mode .hj-account__name { max-width: 30vw; }

/* Friends, Bux and avatar panels */
.hj-panel__note { margin: 4px 0 12px; line-height: 1.5; }
.hj-action {
  width: 100%; margin-top: 8px; padding: 11px; border: 4px solid var(--hj-ink); border-radius: 14px;
  background: linear-gradient(180deg, #58e06a, #2fae42); color: #fff; font-size: 17px; cursor: pointer;
}
.hj-action:disabled { background: linear-gradient(180deg, #b9c2cc, #93a0ad); cursor: not-allowed; }
.hj-friend, .hj-bux { display: flex; align-items: center; gap: 10px; padding: 8px 4px; border-bottom: 2px solid rgba(43,60,88,.16); }
.hj-friend:last-of-type, .hj-bux:last-of-type { border-bottom: none; }
.hj-friend__pfp { width: 34px; height: 34px; border-radius: 50%; border: 2px solid var(--hj-ink); object-fit: cover; flex: none; }
.hj-friend__name, .hj-bux__text { display: flex; flex-direction: column; line-height: 1.25; flex: 1 1 auto; min-width: 0; }
.hj-friend__name b, .hj-friend__name small { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.hj-friend__name small, .hj-bux__text small { opacity: .65; }
.hj-friend__status { font-size: 12px; opacity: .75; flex: none; }
.hj-friend__invite, .hj-bux__buy {
  cursor: pointer; flex: none; border: 3px solid var(--hj-ink); border-radius: 9px; padding: 5px 11px;
  color: #fff; font-size: 13px; background: linear-gradient(180deg, #9bf06a 0%, #4fce2e 60%, #37a81f 100%);
}
.hj-bux__buy { background: linear-gradient(180deg, #ffd76b 0%, #ffa32b 55%, #d97708 100%); }
.hj-friend__invite:disabled, .hj-bux__buy:disabled { filter: saturate(.3) brightness(.85); cursor: default; }
.hj-slider { display: flex; flex-direction: column; gap: 4px; margin-bottom: 12px; font-size: 13px; }
.hj-slider input { width: 100%; accent-color: #b44bff; }

/* FPS readout (Bloxity show_fps) */
.hj-fps {
  position: fixed; right: max(12px, env(safe-area-inset-right, 0px)); bottom: max(12px, env(safe-area-inset-bottom, 0px));
  z-index: 23; padding: 3px 8px; border-radius: 8px; background: rgba(10,16,28,.6); color: #b8ff5c; font-size: 13px; pointer-events: none;
}

/* Phones on their side: the rail becomes a row across the top-left. */
@media (orientation: landscape) and (max-height: 500px) {
  :root { --hj-rail: 52px; }
  .hj-rail { top: max(8px, env(safe-area-inset-top, 0px)); transform: none; grid-template-columns: repeat(5, var(--hj-rail)); gap: 10px; }
  body.hj-touch-mode .hj-hud { bottom: 8px; width: 46vw; }
  .hj-panel__box { max-height: 94vh; }
  .hj-card__gem, .hj-card__pet { width: 40px; height: 40px; margin: 4px 0; }
}
@media (max-width: 560px) {
  :root { --hj-rail: 50px; }
  .hj-rail { top: 30%; gap: 14px 8px; }
  .hj-tile { border-width: 3px; border-radius: 13px; }
  .hj-tile__label { font-size: 10px; bottom: -8px; }
  body.hj-touch-mode .hj-hud { width: 72vw; bottom: calc(2vh + 118px); }
  .hj-hud__height { font-size: 16px; }
  .hj-hud__level, .hj-hud__amount { font-size: 13px; }
  .hj-egg { grid-template-columns: 48px 1fr; }
  .hj-egg__shell { width: 40px; height: 52px; }
  .hj-egg > :last-child { grid-column: 1 / -1; }
  .hj-egg__pets { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .hj-cos { grid-template-columns: 48px 1fr; }
  .hj-cos__swatch { width: 44px; height: 44px; }
  .hj-cos > :last-child { grid-column: 1 / -1; }
}
@media (prefers-reduced-motion: reduce) {
  .hj-tile, .hj-hud__fill { transition: none; }
  .hj-pop--run { animation-duration: 1ms; }
}
`;
  document.head.appendChild(style);
};

/** Supplied HUD art, served from the repo-level assets folder. */
export const iconUrl = (file: string): string => `/ui/${file}`;
const icon = (file: string): string =>
  `<img class="hj-icon" src="${iconUrl(file)}" alt="" draggable="false">`;

/**
 * The food icon: a cartoon apple, drawn as SVG so it costs a few hundred bytes
 * instead of an image file. Also used as an image URL (popups, world signs).
 */
const FOOD_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">' +
  '<path d="M32 19c-6-6-23-5-25 12-2 16 10 29 18 29 3 0 4-2 7-2s4 2 7 2c8 0 20-13 18-29-2-17-19-18-25-12z" fill="#ff4d4d" stroke="#12181f" stroke-width="4" stroke-linejoin="round"/>' +
  '<path d="M32 19c0-6 2-10 6-13" stroke="#12181f" stroke-width="5" fill="none" stroke-linecap="round"/>' +
  '<path d="M32 19c0-6 2-10 6-13" stroke="#8a5a2b" stroke-width="2.5" fill="none" stroke-linecap="round"/>' +
  '<path d="M37 13c6-7 15-6 17-3-4 6-12 7-17 3z" fill="#5cd65c" stroke="#12181f" stroke-width="3" stroke-linejoin="round"/>' +
  '<ellipse cx="21" cy="31" rx="4" ry="7.5" fill="#fff" opacity=".45"/></svg>';

export const FOOD_ICON_URL = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(FOOD_SVG)}`;

const SPEAKER =
  '<svg class="hj-icon" viewBox="0 0 24 24" aria-hidden="true"><path fill="#fff" stroke="#12181f" stroke-width="1.2" d="M4 9h3.2L12 4.6v14.8L7.2 15H4z"/>' +
  '<path fill="none" stroke="#fff" stroke-width="2.2" stroke-linecap="round" d="M15.6 8.6a4.6 4.6 0 0 1 0 6.8M18.4 5.8a8.4 8.4 0 0 1 0 12.4"/></svg>';

export const ICONS = {
  trophy: icon('trophy.png'),
  rebirth: icon('rebirth.png'),
  trail: icon('trail.png'),
  food: `<img class="hj-icon" src="${FOOD_ICON_URL}" alt="" draggable="false">`,
  pets: icon('inventory.png'),
  shop: icon('shop.png'),
  audio: SPEAKER,
} as const;
