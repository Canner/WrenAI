export type {
  ApiKeyAuthChoice,
  AuthChoice,
  AuthOption,
  GatewayAuthChoice,
  LocalAuthChoice,
  SubscriptionAuthChoice,
} from "./types.js";

export { createDefaultLoginProbe } from "./probe.js";
export type { LoginProbe } from "./probe.js";

export { detectAndPick, toAuthChoice } from "./detect.js";
