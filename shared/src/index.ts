/**
 * @highjump/shared - the single source of truth for anything that must be
 * identical between the client and the authoritative server.
 *
 * Nothing in here may import from `three`, `colyseus`, or the DOM.
 */
export * from './constants/network.js';
export * from './constants/world.js';
export * from './config/camera.js';
export * from './config/course.js';
export * from './config/dining.js';
export * from './config/foodRate.js';
export * from './config/foods.js';
export * from './config/playerIdentity.js';
export * from './config/movement.js';
export * from './config/pets.js';
export * from './config/progression.js';
export * from './config/rebirth.js';
export * from './config/trails.js';
export * from './types/math.js';
export * from './types/messages.js';
export * from './sim/WorldCollision.js';
export * from './sim/PlayerSim.js';
