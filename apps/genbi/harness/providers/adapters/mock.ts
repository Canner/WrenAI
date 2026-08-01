import { MockLanguageModelV4 } from "ai/test";

export const MOCK_ADAPTER_ID = "mock";

// Config is whatever `MockLanguageModelV4` accepts: a scriptable set of
// `doGenerate`/`doStream` implementations (or canned results). This keeps
// the mock adapter fully offline and drivable end-to-end from tests.
export type MockAdapterConfig = ConstructorParameters<typeof MockLanguageModelV4>[0];

export function createMockAdapter(config: MockAdapterConfig = {}): MockLanguageModelV4 {
  return new MockLanguageModelV4(config);
}
