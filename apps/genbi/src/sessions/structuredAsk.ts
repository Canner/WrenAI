/** Sessions-owned route for the rich, chart-first Structured Ask surface. */
export function structuredAskPath(sessionId?: string): string {
  return sessionId ? `/sessions/ask/${encodeURIComponent(sessionId)}` : '/sessions/ask';
}
