export class UnknownAdapterError extends Error {
  constructor(adapterId: string) {
    super(`no provider adapter registered for id: "${adapterId}"`);
    this.name = "UnknownAdapterError";
  }
}

export class UnknownTierError extends Error {
  constructor(tier: string) {
    super(`no binding entry for tier: "${tier}"`);
    this.name = "UnknownTierError";
  }
}
