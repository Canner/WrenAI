import { fileURLToPath } from 'node:url';
import { loadBehaviors } from './artifact.mjs';

// The trusted host binds concrete models, structured-output schemas and validators.
// A tier never grants network access, Wren tools, or permission to export data.
const artifact = loadBehaviors(fileURLToPath(new URL('.', import.meta.url)));
export const behaviors = artifact.components;
export const behaviorProvenance = artifact.provenance;
