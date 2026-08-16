export {
  McpServerNotConfiguredError,
  McpToolNotExposedError,
  SetupCommandDeniedError,
  SetupWriteScopeError,
  UnknownNativeToolError,
  UnsupportedToolSourceError,
  WrenBinaryNotFoundError,
  WrenIntrospectExecutionError,
  WrenQueryExecutionError,
} from "./errors.js";

export { parseToolSource } from "./parse.js";
export type { ParsedToolSource } from "./parse.js";

export { resolveWrenBinary } from "./resolve-wren-binary.js";

export {
  assembleDashboardBlocks,
  BUILD_DASHBOARD_TOOL_NAME,
  buildDashboardInputSchema,
  createBuildDashboardTool,
  createDefaultNativeToolRegistry,
  createNativeToolRegistry,
  createWrenNativeToolRegistry,
  createWrenQueryTool,
  createWrenSemanticIntrospectTool,
  createWriteArtifactTool,
  SEMANTIC_INTROSPECT_TOOL_NAME,
  WREN_QUERY_TOOL_NAME,
  WRITE_ARTIFACT_TOOL_NAME,
} from "./native.js";
export type {
  BuildDashboardInput,
  BuildDashboardResult,
  NativeToolFactory,
  NativeToolRegistry,
  WrenNativeToolOptions,
  WrenQueryResult,
  WrenQueryToolOptions,
  WrenSemanticIntrospectResult,
} from "./native.js";

export {
  createSetupExecutionTool,
  executeSetupExecution,
  setupExecutionInputSchema,
  SETUP_EXECUTION_TOOL_NAME,
} from "./setup-native.js";
export type { SetupExecutionInput, SetupExecutionResult, SetupExecutionToolOptions } from "./setup-native.js";

export { connectMcpServer } from "./mcp.js";
export type { McpServerConfig, McpServerConfigMap } from "./mcp.js";

export { resolveTools } from "./resolve.js";
export type { ResolvedTools, ResolveToolsContext } from "./resolve.js";

export { withResolvedTools } from "./wiring.js";
