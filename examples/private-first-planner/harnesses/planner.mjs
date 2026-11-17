import { parsePlanDecision } from '../planner/plan.mjs';

// Shared by the conversation host and the isolated planner evaluator. A model
// proposes a decision; only the host parser can admit it as an executable plan.
export async function decidePlanner({ model, input, parseDecision = parsePlanDecision }) {
  const proposed = await model.decide(input);
  return parseDecision(proposed.name, proposed.args, input.capabilities);
}
