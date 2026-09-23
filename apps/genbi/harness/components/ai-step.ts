import { ToolLoopAgent, isStepCount, jsonSchema, tool, type LanguageModel, type ToolSet } from "ai";
import type { StepResponse, StepRun } from "./runner.js";

/** A fresh AI SDK loop for each host-owned step. No caller history or ambient tools. */
export async function runAiComponentStep(run: StepRun, model: LanguageModel): Promise<StepResponse> {
  const tools: ToolSet = {};
  for (const [name, execute] of Object.entries(run.tools)) {
    const inputSchema = run.toolSchemas[name];
    if (!inputSchema) throw new Error("Component tool has no closed input schema");
    tools[name] = tool({ description: run.toolDescriptions[name] ?? name,
      inputSchema: jsonSchema<Record<string, unknown>>(inputSchema),
      execute: async (input) => execute(input),
    });
  }
  const prompt = JSON.stringify({ request: run.request, input: run.input, consumes: run.consumes });
  const agent = new ToolLoopAgent({ model, tools, stopWhen: isStepCount(12),
    instructions: [run.brief, run.prompt].filter(Boolean).join("\n\n"),
  });
  const result = await agent.generate({ prompt, abortSignal: run.signal });
  return {
    value: result.text,
    failed: result.finishReason !== "stop" || result.steps.some((step) => step.content.some((part) => part.type === "tool-error")),
    usage: { inputTokens: result.totalUsage.inputTokens ?? 0, outputTokens: result.totalUsage.outputTokens ?? 0 },
  };
}
