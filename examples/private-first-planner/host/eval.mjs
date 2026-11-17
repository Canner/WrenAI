import { plannerUnit } from '../eval/units.mjs';
import { plannerContract } from '../planner/intent.mjs';
import { PiPlanner } from './pi.mjs';
import { designWithRepair } from './cloud.mjs';

// These factories plug into eval/runSuite without starting the conversational
// host. The same executors and contracts are used in the deployed composition.
export function piPlannerUnit(options, config) {
  return plannerUnit({ ...options, model: new PiPlanner(config), parseDecision: plannerContract.parse });
}
export function cloudRepairUnit(options, ports) {
  return { run: () => designWithRepair({ ...ports, signal: options.signal, timeoutMs: options.binding.limits.timeout_ms }),
    close: () => ports.broker.revoke() };
}
