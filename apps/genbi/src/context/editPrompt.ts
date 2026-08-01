import type { ImpactNode } from './types';

export interface EditPromptInput {
  /** Absolute file path to edit (see `joinProjectPath`). */
  filePath: string;
  /** Project name/slug, for orienting the CLI session. */
  projectName: string;
  /** This file's downstream dependents (from its `BlastRadius`), if any. */
  downstream: ImpactNode[];
  /** Count of verified Question-SQL pairs that must still pass after the edit. */
  verifiedPairCount: number;
}

const KIND_LABEL: Record<ImpactNode['kind'], string> = {
  model: 'model',
  measure: 'measure',
  relationship: 'relationship',
  view: 'view',
};

/**
 * Build the copy-ready prompt shown in the "Claude Code CLI" Edit option. Pure
 * and unit-testable: given a file's path, project, downstream dependents, and
 * verified-pair count, returns the exact text to paste into a CLI session.
 * Always includes a verify-gate note — changes to the semantic layer must
 * re-pass the verified Question-SQL pairs before deploy.
 */
export function buildEditPrompt({
  filePath,
  projectName,
  downstream,
  verifiedPairCount,
}: EditPromptInput): string {
  const lines: string[] = [];

  lines.push(`Project: ${projectName}`);
  lines.push(`File: ${filePath}`);
  lines.push('');

  if (downstream.length === 0) {
    lines.push('Downstream dependents: none known.');
  } else {
    lines.push('Downstream dependents:');
    for (const node of downstream) {
      lines.push(`- ${node.name} (${KIND_LABEL[node.kind]})`);
    }
  }

  lines.push('');
  lines.push(
    `Verify gate: this change must re-pass all ${verifiedPairCount} verified Question-SQL pairs before it can be deployed.`,
  );

  return lines.join('\n');
}
