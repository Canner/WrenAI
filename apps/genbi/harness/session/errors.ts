/** Thrown by `runAgent` when `agentId` doesn't name any agent in the bundle. */
export class UnknownAgentError extends Error {
  constructor(agentId: string) {
    super(`no agent with id "${agentId}" in this bundle`);
    this.name = "UnknownAgentError";
  }
}
