/**
 * The credential form used to render one bare SHOUTING_KEY per input. For
 * BigQuery that meant `BIGQUERY_TYPE` appeared as an empty box whose only
 * acceptable value is fixed by wren, and `BIGQUERY_CREDENTIALS` gave no clue
 * that it wants base64 of a service-account file. wren publishes all of that;
 * these tests pin the join that brings it across.
 */
import { describe, expect, it } from "vitest";
import { annotateEnvFields } from "../server/env-field-hints.js";
import { parseSourceCatalog } from "../server/source-catalog.js";

const bigquery = parseSourceCatalog(
  JSON.stringify({
    bigquery: {
      variants: {
        BigQueryDatasetConnectionInfo: {
          properties: {
            credentials: { description: "Base64 encode `credentials.json`", examples: ["eyJ..."], format: "password", title: "Credentials", type: "string" },
            project_id: { examples: ["my-project"], title: "Project Id", type: "string" },
            dataset_id: { examples: ["my_dataset"], title: "Dataset Id", type: "string" },
            bigquery_type: { const: "dataset", default: "dataset", title: "Bigquery Type", type: "string" },
            job_timeout_ms: { anyOf: [{ type: "integer" }, { type: "null" }], default: null, title: "Job Timeout Ms" },
          },
          required: ["credentials", "project_id", "dataset_id"],
        },
      },
    },
  }),
)[0]!;

const annotate = (keys: string[]) => annotateEnvFields(keys.map((key) => ({ key, secret: false })), bigquery);

describe("annotateEnvFields", () => {
  it("gives a prefixed key its field's title, example and required flag", () => {
    const [field] = annotate(["BIGQUERY_PROJECT_ID"]);
    expect(field).toMatchObject({ key: "BIGQUERY_PROJECT_ID", label: "Project Id", example: "my-project", required: true });
  });

  it("matches a field whose own name already carries the source prefix", () => {
    // `bigquery_type` would become BIGQUERY_BIGQUERY_TYPE under naive
    // prefixing; the template says BIGQUERY_TYPE, and both must resolve.
    const [field] = annotate(["BIGQUERY_TYPE"]);
    expect(field?.label).toBe("Bigquery Type");
  });

  it("carries the fixed value of a variant discriminator so the form need not ask", () => {
    const [field] = annotate(["BIGQUERY_TYPE"]);
    expect(field?.fixedValue).toBe("dataset");
  });

  it("marks a base64-of-a-file field so the form can offer a picker", () => {
    const [credentials] = annotate(["BIGQUERY_CREDENTIALS"]);
    expect(credentials).toMatchObject({ fileEncoded: true, description: "Base64 encode `credentials.json`", secret: true });
    // Only that field: a plain id is not a file.
    expect(annotate(["BIGQUERY_PROJECT_ID"])[0]?.fileEncoded).toBeUndefined();
  });

  it("treats wren's own password format as authoritative for secrecy", () => {
    // The route's fallback is a name heuristic; "CREDENTIALS" happens to match
    // it, but the catalog is what actually knows.
    const [field] = annotateEnvFields([{ key: "BIGQUERY_CREDENTIALS", secret: false }], bigquery);
    expect(field?.secret).toBe(true);
  });

  it("reports an optional field as not required", () => {
    expect(annotate(["BIGQUERY_JOB_TIMEOUT_MS"])[0]?.required).toBe(false);
  });

  it("passes through a key it cannot explain rather than dropping it", () => {
    // The template is the agent's output. An unmatched key still has to be
    // fillable, or a credential the connection needs becomes unreachable.
    const [field] = annotate(["SOMETHING_UNEXPECTED"]);
    expect(field).toEqual({ key: "SOMETHING_UNEXPECTED", secret: false });
  });

  it("returns the fields untouched when the source is unknown", () => {
    const input = [{ key: "PGHOST", secret: false }];
    expect(annotateEnvFields(input, undefined)).toBe(input);
  });
});
