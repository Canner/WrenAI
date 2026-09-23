/** Drain every owned resource and report cleanup failures without process details. */
export async function shutdownNativeResources(options: {
  shutdownSessions(): Promise<void>;
  closeTerminals(): void;
  closeServer(): void;
}): Promise<0 | 1> {
  let failed = false;
  // Calling the session fence before other cleanup closes new admission immediately.
  let cleanup: Promise<void> = Promise.resolve();
  try { cleanup = options.shutdownSessions(); } catch { failed = true; }
  // Attach the rejection observer before synchronous cleanup can throw.
  const settled = cleanup.catch(() => { failed = true; });
  try { options.closeTerminals(); } catch { failed = true; }
  try { options.closeServer(); } catch { failed = true; }
  await settled;
  return failed ? 1 : 0;
}
