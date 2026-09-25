import { BloxityVerifier } from './bloxity/BloxityVerifier.js';
import { serverConfig } from './config/serverConfig.js';
import { createPersistence } from './persistence/index.js';
import { ProfileService } from './progression/ProfileService.js';

/**
 * The process's long-lived services, created once at boot.
 *
 * Kept out of the modules that use them so the progression services and their
 * tests can be imported without opening a store.
 */
export const persistence = createPersistence(serverConfig.mongoUri, serverConfig.dataDir);
export const profileService = new ProfileService(persistence.profiles);
export const grantStore = persistence.grants;
export const verifier = new BloxityVerifier(serverConfig.bloxityGameId);
