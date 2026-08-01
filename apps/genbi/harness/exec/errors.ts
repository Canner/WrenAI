/** Thrown when a requested path resolves outside its granted scope (directory traversal). */
export class PathTraversalError extends Error {
  constructor(requestedPath: string, scope: string) {
    super(`path "${requestedPath}" escapes the scoped workspace "${scope}"`);
    this.name = "PathTraversalError";
  }
}

/** Thrown by `writeFile` when the policy grants no `artifactWriteScope` at all. */
export class WriteScopeNotGrantedError extends Error {
  constructor(requestedPath: string) {
    super(
      `write to "${requestedPath}" rejected: the enforcement policy grants no artifactWriteScope ` +
        `(the agent has no locked scoped_write guardrail)`,
    );
    this.name = "WriteScopeNotGrantedError";
  }
}

/** Thrown by `exec` when a `mode: "write"` command runs under a read-only policy. */
export class ReadOnlyViolationError extends Error {
  constructor(command: string) {
    super(`command "${command}" declares mode: "write" but the enforcement policy is read-only`);
    this.name = "ReadOnlyViolationError";
  }
}

/** Thrown by `fetch` when the target host isn't in the policy's egress allowlist. */
export class EgressNotAllowedError extends Error {
  constructor(host: string) {
    super(`fetch to host "${host}" is not in the egress allowlist`);
    this.name = "EgressNotAllowedError";
  }
}
