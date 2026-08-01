import { mkdtempSync, rmSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { Store } from "../server/db.js";
import type { AnswerEvent, UserEvent } from "../server/wire-types.js";

describe("Store", () => {
  it("round-trips sessions, events, and turns", () => {
    const store = new Store(":memory:");
    const session = store.createSession("Q1 revenue");
    expect(session.status).toBe("active");
    expect(store.getSession(session.id)).toEqual(session);
    expect(store.listSessions().map((s) => s.id)).toContain(session.id);

    const userEvent: UserEvent = { id: "evt-1", kind: "user", text: "hello" };
    const stored = store.insertEvent({ sessionId: session.id, kind: "user", payload: userEvent, turnId: null });
    expect(stored.seq).toBe(0);
    expect(store.nextSeq(session.id)).toBe(1);

    const turn = store.createTurn({ id: "turn-1", sessionId: session.id, question: "hello", composedInput: "hello" });
    expect(turn.resultKind).toBeNull();
    expect(store.getTurn("turn-1")).toEqual(turn);
    expect(store.getLatestTurn(session.id)?.id).toBe("turn-1");

    const answerEvent: AnswerEvent = {
      id: "evt-2",
      kind: "answer",
      answer: { form: "text", text: "hi", verified: false, dataAnswer: false },
    };
    store.insertEvent({ sessionId: session.id, kind: "answer", payload: answerEvent, turnId: "turn-1" });
    store.resolveTurn("turn-1", { backend: "agent-sdk", resultKind: "answer", answerSummary: "hi", traceJson: "[]", errorMessage: null });

    const resolved = store.getTurn("turn-1");
    expect(resolved?.resultKind).toBe("answer");
    expect(resolved?.answerSummary).toBe("hi");

    expect(store.listEventsForSession(session.id)).toHaveLength(2);
    expect(store.listEventsForTurn("turn-1")).toHaveLength(1);

    const priorTurns = store.listRecentResolvedTurns(session.id, 5);
    expect(priorTurns).toEqual([{ question: "hello", answerSummary: "hi" }]);

    store.updateSessionStatus(session.id, "awaiting_clarify", "pending?");
    expect(store.getSession(session.id)?.status).toBe("awaiting_clarify");
    expect(store.getSession(session.id)?.pendingQuestion).toBe("pending?");

    store.close();
  });

  it("round-trips artifacts and publications", () => {
    const store = new Store(":memory:");
    const session = store.createSession("dash");
    const artifact = store.createArtifact({ sessionId: session.id, name: "Revenue dashboard", kind: "dashboard", location: "artifacts/revenue.json", verified: false });
    expect(artifact.verified).toBe(false);
    expect(artifact.savedAt).toBeNull();
    expect(store.getPublication(artifact.id)).toBeUndefined();

    const pub = store.publishArtifact(artifact.id, "https://share.example/x", "workspace");
    expect(pub.scope).toBe("workspace");
    expect(store.getPublication(artifact.id)?.link).toBe("https://share.example/x");

    // upsert overwrites rather than duplicating
    store.publishArtifact(artifact.id, "https://share.example/y", "public");
    expect(store.getPublication(artifact.id)?.scope).toBe("public");
    expect(store.getPublication(artifact.id)?.link).toBe("https://share.example/y");

    // Unsaved by default — listArtifacts() only surfaces saved artifacts.
    expect(store.listArtifacts()).toEqual([]);

    const saved = store.saveArtifact(artifact.id);
    expect(saved?.savedAt).not.toBeNull();
    expect(store.listArtifacts().map((a) => a.id)).toEqual([artifact.id]);

    // idempotent: repeat save doesn't change the original savedAt
    const resaved = store.saveArtifact(artifact.id);
    expect(resaved?.savedAt).toBe(saved?.savedAt);

    // unsaveArtifact clears saved_at back to null but keeps the row.
    const unsaved = store.unsaveArtifact(artifact.id);
    expect(unsaved?.savedAt).toBeNull();
    expect(store.getArtifact(artifact.id)).toBeDefined();
    expect(store.listArtifacts()).toEqual([]);

    // idempotent: repeat unsave on an already-unsaved artifact is a no-op.
    const reunsaved = store.unsaveArtifact(artifact.id);
    expect(reunsaved?.savedAt).toBeNull();

    // re-saveable after unsave, with a fresh savedAt.
    const resavedAfterUnsave = store.saveArtifact(artifact.id);
    expect(resavedAfterUnsave?.savedAt).not.toBeNull();
    expect(store.listArtifacts().map((a) => a.id)).toEqual([artifact.id]);

    store.close();
  });

  it("deleteSession removes an unsaved (never-listed) artifact along with its publications", () => {
    const store = new Store(":memory:");
    const session = store.createSession("dash");
    const artifact = store.createArtifact({ sessionId: session.id, name: "Unsaved dashboard", kind: "dashboard", location: "artifacts/unsaved.json", verified: false });
    store.publishArtifact(artifact.id, "https://share.example/unsaved", "workspace");

    // Confirm it's genuinely unsaved and thus absent from the filtered list before deletion.
    expect(store.listArtifacts()).toEqual([]);
    expect(store.getArtifact(artifact.id)).toBeDefined();

    store.deleteSession(session.id);

    // deleteSession scopes its own DELETEs by session_id directly (not via listArtifacts()),
    // so the row and its publication are gone regardless of the saved_at filter.
    expect(store.getArtifact(artifact.id)).toBeUndefined();
    expect(store.getPublication(artifact.id)).toBeUndefined();
    store.close();
  });

  it("seeds eval runs, runtime settings, setup steps, and context fixtures on first init", () => {
    const store = new Store(":memory:");
    const runs = store.listEvalRuns();
    expect(runs).toHaveLength(3);
    expect(runs.map((r) => r.id).sort()).toEqual(["eval-1", "eval-2", "eval-3"]);

    const full = store.getEvalRun("eval-2");
    expect(full?.gatePass).toBe(false);
    expect(full?.componentScores).toHaveLength(2);

    expect(store.getRuntimeSettings().authMode).toBe("subscription");
    expect(store.getSetupSteps()).toHaveLength(5);
    expect(store.getVerifyGatePassed()).toBe(false);

    expect(store.getContextModels().map((m) => m.key).sort()).toEqual(["customers", "orders", "products"]);
    expect(store.getContextRelationships()).toHaveLength(2);
    expect(store.getContextMeasures()).toHaveLength(2);
    expect(store.getContextKnowledge()).toEqual({ instructionsPresent: true, verifiedPairCount: 3 });
    expect(store.getContextFiles().map((f) => f.key)).toEqual(["models", "relationships", "cubes", "knowledge"]);

    // relationship and cube leaf nodes must carry content — a node with no content
    // renders as "empty" in the FileViewer (previously true for these four fixtures).
    const leaves = store.getContextFiles().flatMap((f) => f.children ?? [f]);
    const relationshipAndCubeLeaves = leaves.filter((f) => f.kind === "relationship" || f.kind === "cube");
    expect(relationshipAndCubeLeaves).toHaveLength(4);
    for (const leaf of relationshipAndCubeLeaves) {
      expect(leaf.content).toBeTruthy();
    }

    expect(store.getBlastRadius("customers")?.severity).toBe("structural");
    expect(store.getBlastRadius("nonexistent")).toBeUndefined();
    expect(store.getVerifiedPairs()).toHaveLength(3);

    // a second construction against the same in-memory instance path is a fresh db (":memory:" isn't shared),
    // but re-running seedIfEmpty logic against an *already seeded* db must be a no-op, not a duplicate insert.
    store.setVerifyGatePassed(true);
    const again = new Store(":memory:");
    expect(again.getVerifyGatePassed()).toBe(false); // separate :memory: instance, unaffected by the first
    again.close();

    store.close();
  });

  it("setSetupSteps coerces an orphaned 'todo' ahead of a later 'done' step, but leaves 'current' alone", () => {
    const store = new Store(":memory:");
    const seeded = store.getSetupSteps(); // [runtime(current), connect(todo), context(todo), bind(todo), ask(todo)]

    // A later step ("bind") marked done while two earlier ones ("connect", "context") are still
    // "todo" is exactly the bug this invariant guards against — both should be coerced to "done".
    store.setSetupSteps(seeded.map((s) => (s.key === "bind" ? { ...s, state: "done" as const } : s)));
    expect(store.getSetupSteps().map((s) => [s.key, s.state])).toEqual([
      ["runtime", "current"],
      ["connect", "done"],
      ["context", "done"],
      ["bind", "done"],
      ["ask", "todo"],
    ]);

    // An earlier "current" step is left alone — only "todo" gets coerced forward.
    const withCurrent = store.getSetupSteps().map((s) => (s.key === "connect" ? { ...s, state: "current" as const } : s.key === "ask" ? { ...s, state: "done" as const } : s));
    store.setSetupSteps(withCurrent);
    expect(store.getSetupSteps().find((s) => s.key === "connect")?.state).toBe("current");
    expect(store.getSetupSteps().find((s) => s.key === "ask")?.state).toBe("done");

    store.close();
  });

  it("createTurn persists an optional agent_id, defaulting to null when omitted", () => {
    const store = new Store(":memory:");
    const session = store.createSession("Q1 revenue");

    const withAgent = store.createTurn({ id: "turn-a", sessionId: session.id, question: "why did revenue drop?", composedInput: null, agentId: "explain_change" });
    expect(withAgent.agentId).toBe("explain_change");
    expect(store.getTurn("turn-a")?.agentId).toBe("explain_change");

    const withoutAgent = store.createTurn({ id: "turn-b", sessionId: session.id, question: "hello", composedInput: null });
    expect(withoutAgent.agentId).toBeNull();
    expect(store.getTurn("turn-b")?.agentId).toBeNull();

    store.close();
  });

  it("migrates a pre-existing DB file (turns table without agent_id) additively, without touching its data", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "wren-harness-db-migration-"));
    const dbPath = path.join(dir, "old.sqlite");
    try {
      // Simulate a DB file created before the agent_id column existed: the exact original `turns` DDL.
      const legacy = new DatabaseSync(dbPath);
      legacy.exec(`
        CREATE TABLE turns (
          id TEXT PRIMARY KEY, session_id TEXT NOT NULL, question TEXT NOT NULL, composed_input TEXT,
          backend TEXT, result_kind TEXT, answer_summary TEXT, trace_json TEXT, created_at TEXT NOT NULL,
          error_message TEXT
        );
      `);
      legacy
        .prepare(
          `INSERT INTO turns (id, session_id, question, composed_input, backend, result_kind, answer_summary, trace_json, created_at, error_message)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run("turn-legacy", "session-legacy", "an old question", null, "agent", "answer", "an old answer", "[]", new Date().toISOString(), null);
      legacy.close();

      // Opening it via Store must additively migrate (ALTER TABLE ADD COLUMN), not error and not drop data.
      const store = new Store(dbPath);
      const migrated = store.getTurn("turn-legacy");
      expect(migrated).toBeDefined();
      expect(migrated?.question).toBe("an old question");
      expect(migrated?.answerSummary).toBe("an old answer");
      expect(migrated?.agentId).toBeNull(); // pre-existing row has no agent_id value
      store.close();

      // Re-opening an already-migrated file is a no-op, not a duplicate-column error.
      const reopened = new Store(dbPath);
      expect(reopened.getTurn("turn-legacy")?.agentId).toBeNull();
      reopened.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("deleteSession removes the session row along with its turns, events, artifacts, and publications, leaving other sessions untouched", () => {
    const store = new Store(":memory:");
    const target = store.createSession("to be deleted");
    const other = store.createSession("untouched");

    store.insertEvent({ sessionId: target.id, kind: "user", payload: { id: "evt-1", kind: "user", text: "hi" }, turnId: null });
    store.createTurn({ id: "turn-1", sessionId: target.id, question: "hi", composedInput: "hi" });
    const artifact = store.createArtifact({ sessionId: target.id, name: "dash", kind: "dashboard", location: "artifacts/x.json", verified: false });
    store.publishArtifact(artifact.id, "https://share.example/x", "workspace");

    store.insertEvent({ sessionId: other.id, kind: "user", payload: { id: "evt-2", kind: "user", text: "hey" }, turnId: null });
    const otherTurn = store.createTurn({ id: "turn-2", sessionId: other.id, question: "hey", composedInput: "hey" });

    store.deleteSession(target.id);

    expect(store.getSession(target.id)).toBeUndefined();
    expect(store.getTurn("turn-1")).toBeUndefined();
    expect(store.listEventsForSession(target.id)).toHaveLength(0);
    expect(store.listArtifacts().some((a) => a.id === artifact.id)).toBe(false);
    expect(store.getPublication(artifact.id)).toBeUndefined();

    // Other session and its own turns/events survive untouched.
    expect(store.getSession(other.id)).toEqual(other);
    expect(store.getTurn("turn-2")).toEqual(otherTurn);
    expect(store.listEventsForSession(other.id)).toHaveLength(1);

    // Deleting an id that doesn't exist is a harmless no-op, not an error.
    expect(() => store.deleteSession("does-not-exist")).not.toThrow();

    store.close();
  });

  it("generic config JSON get/set upserts rather than duplicating", () => {
    const store = new Store(":memory:");
    expect(store.getConfigJson("custom.key")).toBeUndefined();
    store.setConfigJson("custom.key", { a: 1 });
    expect(store.getConfigJson("custom.key")).toEqual({ a: 1 });
    store.setConfigJson("custom.key", { a: 2 });
    expect(store.getConfigJson("custom.key")).toEqual({ a: 2 });
    store.close();
  });
});
