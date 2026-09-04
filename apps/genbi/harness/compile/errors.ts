/**
 * Thrown by {@link resolveWarbleBinary} (see `./resolve-binary.js`) when no `warble` binary can be
 * found via any of its four resolution tiers (explicit arg, installed `@warble/cli` package,
 * `PATH`, opt-in sibling repo release build). Deliberately loud — this pipeline never silently
 * degrades to "skip compiling".
 */
export class WarbleBinaryNotFoundError extends Error {
  constructor(attempts: readonly string[]) {
    super(
      `could not resolve a "warble" binary:\n` +
        attempts.map((attempt) => `  - ${attempt}`).join("\n") +
        `\nfix: pass "warbleBin" explicitly, run "pnpm install" so "@warble/cli" is installed, or ` +
        `put "warble" on PATH.`,
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

/**
 * Thrown by {@link resolveContextLoaderBinary} (see `./context-loader.js`) when the
 * `wren-context-loader` generator can be found neither via an explicit override nor as an in-repo
 * build. Deliberately loud, and deliberately *not* recoverable by falling back to the old
 * `wren_project` binding: Warble emits neither `kind` nor `document` into the IR, so a silent
 * degrade to the built-in MDL adapter would be invisible in the compiled artifact.
 */
export class ContextLoaderNotFoundError extends Error {
  constructor(attempts: readonly string[]) {
    super(
      `could not resolve the "wren-context-loader" binary:\n` +
        attempts.map((attempt) => `  - ${attempt}`).join("\n") +
        `\nfix: install the exact @wrenai/context-loader package, build it in-repo from the repository root ` +
        `("cargo build --release --manifest-path core/wren-context-loader/Cargo.toml") ` +
        `or point WREN_HARNESS_CONTEXT_LOADER_BIN at an existing build.`,
    );
    this.name = "ContextLoaderNotFoundError";
  }
}

/** Thrown when the `wren-context-loader` subprocess exits non-zero. */
export class ContextLoaderFailedError extends Error {
  constructor(
    public readonly command: string,
    public readonly args: readonly string[],
    public readonly exitCode: number,
    public readonly stderr: string,
    public readonly stdout: string = "",
  ) {
    const diagnostics = [stderr.trim(), stdout.trim()].filter((chunk) => chunk.length > 0).join("\n");
    super(`"${command} ${args.join(" ")}" exited ${exitCode}:\n${diagnostics || "(no output)"}`);
    this.name = "ContextLoaderFailedError";
  }
}

/** Thrown when a Warble profile directory doesn't have the expected `profile.yml` / context-binding shape. */
export class InvalidProfileShapeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidProfileShapeError";
  }
}
