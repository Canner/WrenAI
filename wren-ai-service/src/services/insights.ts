import { getInsightsLlm } from '../providers/llm/index.js';

export interface InsightInput {
  sql: string;
  rows: any[];
  columns: string[];
}

export async function createInsights({ sql, rows, columns }: InsightInput) {
  const enabled = String(process.env.INSIGHTS_ENABLED ?? 'true').toLowerCase() === 'true';
  if (!enabled) return { insights: [], disabled: true };

  const llm = getInsightsLlm();

  // keep prompt concise for speed
  const sample = (rows ?? []).slice(0, 10); // was 50

  const prompt = `You are a BI analyst. Summarize key takeaways from this SQL result.
Return 3–5 concise, numerically-grounded bullet points.

SQL:
${sql}

Columns: ${columns?.join(', ')}

Sample rows (first 10):
${JSON.stringify(sample, null, 2)}
`;

  const text = await llm.generate(prompt);
  return { insights: text.trim() };
}
