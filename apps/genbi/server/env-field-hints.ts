/**
 * Gives each key in a scaffolded `.env` template the description wren already
 * publishes for it.
 *
 * The credential form is field-key-driven: it renders one input per `KEY=` line
 * the connect turn wrote, and until now that was all it knew — a name in caps
 * and whether it looked secret. So `BIGQUERY_TYPE` arrived as an empty box with
 * no way to know it is a fixed discriminator, and `BIGQUERY_CREDENTIALS` gave
 * no hint that it wants base64 of a service-account file.
 *
 * None of that had to be invented: `wren docs connection-info` already carries a
 * title, prose, a worked example, required-ness and, for discriminators, the
 * `const` value. This joins the two.
 */
import type { CatalogSource, SourceField } from "./source-catalog.js";

export interface EnvFieldHint {
  readonly key: string;
  readonly secret: boolean;
  /** wren's human title, e.g. "Dataset Id". Absent when the key matched no field. */
  readonly label?: string;
  readonly description?: string;
  readonly example?: string;
  readonly required?: boolean;
  /**
   * Set when wren fixes this field's value. The form shows it rather than
   * asking, since a discriminator's value is decided by the variant, not by
   * the user.
   */
  readonly fixedValue?: string;
  readonly defaultValue?: string;
  /**
   * True when the field wants base64 of a file's contents — wren says so in its
   * own description. The form offers a file picker for these instead of
   * expecting a hand-encoded blob.
   */
  readonly fileEncoded?: boolean;
}

/** wren describes these as "Base64 encode `<file>`"; nothing else marks them. */
function wantsFileUpload(field: SourceField): boolean {
  return /base64\s+encode/i.test(field.description ?? "");
}

/**
 * The connect turn writes `.env` keys from the field names, upper-cased and
 * usually prefixed with the source. Both shapes occur — `BIGQUERY_PROJECT_ID`
 * for `project_id`, and `BIGQUERY_TYPE` for `bigquery_type`, where the prefix
 * would otherwise be doubled — so match the unprefixed name first and fall back
 * to the prefixed one.
 */
function matchField(key: string, sourceKey: string, fields: readonly SourceField[]): SourceField | undefined {
  const upper = key.toUpperCase();
  const prefix = `${sourceKey.toUpperCase()}_`;
  const unprefixed = upper.startsWith(prefix) ? upper.slice(prefix.length) : upper;
  return (
    fields.find((field) => field.name.toUpperCase() === upper) ??
    fields.find((field) => field.name.toUpperCase() === unprefixed)
  );
}

/**
 * Annotates env keys with their source's field metadata. Keys that match
 * nothing are returned unchanged rather than dropped: the template is the
 * agent's output, and a key we cannot explain still has to be fillable.
 */
export function annotateEnvFields(
  fields: readonly { readonly key: string; readonly secret: boolean }[],
  source: CatalogSource | undefined,
): readonly EnvFieldHint[] {
  if (source === undefined) return fields;
  // Variants are alternative authentication shapes for the same source; the
  // template only ever reflects one, so search them all and take the first hit.
  const all = source.variants.flatMap((variant) => variant.fields);
  return fields.map((field) => {
    const matched = matchField(field.key, source.key, all);
    if (matched === undefined) return field;
    return {
      key: field.key,
      // wren's `format: password` is the authority on whether a value is a
      // credential; the route's name heuristic is only a fallback.
      secret: field.secret || matched.secret,
      label: matched.label,
      required: matched.required,
      ...(matched.description !== undefined ? { description: matched.description } : {}),
      ...(matched.example !== undefined ? { example: matched.example } : {}),
      ...(matched.fixedValue !== undefined ? { fixedValue: matched.fixedValue } : {}),
      ...(matched.defaultValue !== undefined ? { defaultValue: matched.defaultValue } : {}),
      ...(wantsFileUpload(matched) ? { fileEncoded: true } : {}),
    };
  });
}
