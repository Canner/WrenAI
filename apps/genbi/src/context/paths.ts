/**
 * Join a project's absolute root path with a project-relative file path into
 * a single absolute path, with no doubled separators. `ContextFileNode.path`
 * (and `EditDropdown`'s `filePath` prop) is project-relative — see
 * `types.ts` — while the BFF's `ContextOverviewData.projectPath` is the
 * project's absolute filesystem root. Used to turn the two into an absolute
 * path for the Edit dropdown's IDE deep links and CLI prompt (see
 * `EditDropdown`, `buildEditPrompt`).
 *
 * The result always starts with `/`. When `projectPath` is empty (an unbound
 * live project has no absolute root to join against), the relative path is
 * returned with a leading `/` as a best-effort fallback.
 */
export function joinProjectPath(projectPath: string, filePath: string): string {
  const relative = filePath.replace(/^\/+/, '');
  if (!projectPath) return `/${relative}`;
  const root = projectPath.replace(/\/+$/, '');
  return `${root}/${relative}`;
}
