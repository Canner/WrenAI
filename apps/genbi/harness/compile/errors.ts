/**
 * Thrown by {@link resolveWarbleBinary} (see `./resolve-binary.js`) when no `warble` binary can be
 * found via any of its three resolution tiers (explicit arg, `PATH`, sibling repo release build).
 * Deliberately loud — this pipeline never silently degrades to "skip compiling".
 */
export class WarbleBinaryNotFoundError extends Error {
  constructor(attempts: readonly string[]) {
    super(
      `could not resolve a "warble" binary:\n` +
        attempts.map((attempt) => `  - ${attempt}`).join("\n") +
        `\nfix: pass "warbleBin" explicitly, put "warble" on PATH, or build it ` +
        `("cargo build --release --bin warble" in the warble repo).`,
    );
    this.name = "WarbleBinaryNotFoundError";
  }
}

/** Thrown when a `warble` subprocess (compile or dispatch) exits non-zero. */
export class WarbleCommandFailedError extends Error {
  constructor(
    public readonly command: string,
    public readonly args: readonly string[],
    public readonly exitCode: number,
    public readonly stderr: string,
    public readonly stdout: string = "",
  ) {
    // warble reports diagnostics on stderr, but capture stdout too so nothing useful is dropped.
    const diagnostics = [stderr.trim(), stdout.trim()].filter((chunk) => chunk.length > 0).join("\n");
    super(`"${command} ${args.join(" ")}" exited ${exitCode}:\n${diagnostics || "(no output)"}`);
    this.name = "WarbleCommandFailedError";
  }
}

/** Thrown when a Warble profile directory doesn't have the expected `profile.yml` / context-binding shape. */
export class InvalidProfileShapeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidProfileShapeError";
  }
}
