import { fileURLToPath } from 'node:url';
import { loadBehaviors } from '../../behaviors/artifact.mjs';
import { behaviorContract } from './contract.mjs';
export const artifact = loadBehaviors(fileURLToPath(new URL('.', import.meta.url)), behaviorContract);
