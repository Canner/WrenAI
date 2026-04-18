// The post-SQL answer flow can legitimately spend ~30s fetching preview data
// from the engine and another ~120s streaming the final text answer from
// wren-ai-service. Keep the client-side response polling window longer than
// that backend budget so real PG/TiDB workspaces do not time out while the
// answer is still being finalized.
const ENGINE_PREVIEW_TIMEOUT_MS = 30_000;
const TEXT_ANSWER_STREAM_TIMEOUT_MS = 120_000;
const CLIENT_POLL_BUFFER_MS = 15_000;

export const ANSWER_FINALIZATION_POLL_TIMEOUT_MS =
  ENGINE_PREVIEW_TIMEOUT_MS +
  TEXT_ANSWER_STREAM_TIMEOUT_MS +
  CLIENT_POLL_BUFFER_MS;
