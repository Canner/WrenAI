import {fileURLToPath} from 'node:url';
import {loadBehaviors} from '../../behaviors/artifact.mjs';
import {behaviorContract} from './contract.mjs';
const artifact=loadBehaviors(fileURLToPath(new URL('.',import.meta.url)),behaviorContract);
export const behaviors=artifact.components;
export const provenance=artifact.provenance;
