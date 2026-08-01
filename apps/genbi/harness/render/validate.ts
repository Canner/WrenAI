/**
 * A minimal, structural validator for the JSON Schema subset an
 * `agent.output_schema` document actually uses (`type`, `properties`,
 * `required`, `items`, `const`, and a `type` array for nullable unions like
 * `["string", "null"]`). This is deliberately not a general-purpose JSON
 * Schema engine — `jsonSchema()` from the AI SDK performs *no* runtime
 * validation on its own unless given a `validate` callback (confirmed by
 * reading `safeValidateTypes`: a schema with no `.validate` always reports
 * success), so this is what gives the envelope stage real teeth: a
 * malformed model response is rejected, not silently passed through.
 */
export type JsonSchemaDocument = Record<string, unknown>;

export function collectJsonSchemaErrors(schema: JsonSchemaDocument, value: unknown): string[] {
  const errors: string[] = [];
  validateNode(schema, value, "$", errors);
  return errors;
}

function validateNode(schema: JsonSchemaDocument, value: unknown, path: string, errors: string[]): void {
  if ("const" in schema) {
    if (value !== schema.const) {
      errors.push(`${path}: expected const ${JSON.stringify(schema.const)}, got ${JSON.stringify(value)}`);
    }
    return;
  }

  const type = schema.type;
  if (type !== undefined && !matchesType(type, value)) {
    errors.push(`${path}: expected type ${JSON.stringify(type)}, got ${describeType(value)}`);
    return;
  }

  if (includesType(type, "object") && isPlainObject(value)) {
    validateObjectShape(schema, value, path, errors);
  }

  if (includesType(type, "array") && Array.isArray(value)) {
    validateArrayItems(schema, value, path, errors);
  }
}

function validateObjectShape(
  schema: JsonSchemaDocument,
  value: Record<string, unknown>,
  path: string,
  errors: string[],
): void {
  const required = Array.isArray(schema.required) ? (schema.required as unknown[]) : [];
  for (const key of required) {
    if (typeof key === "string" && !(key in value)) {
      errors.push(`${path}: missing required property "${key}"`);
    }
  }

  const properties = isPlainObject(schema.properties) ? (schema.properties as Record<string, unknown>) : undefined;
  if (!properties) return;

  for (const [key, propSchema] of Object.entries(properties)) {
    if (key in value && isPlainObject(propSchema)) {
      validateNode(propSchema as JsonSchemaDocument, value[key], `${path}.${key}`, errors);
    }
  }
}

function validateArrayItems(schema: JsonSchemaDocument, value: unknown[], path: string, errors: string[]): void {
  if (!isPlainObject(schema.items)) return;
  const itemsSchema = schema.items as JsonSchemaDocument;
  value.forEach((item, index) => validateNode(itemsSchema, item, `${path}[${index}]`, errors));
}

function matchesType(type: unknown, value: unknown): boolean {
  if (Array.isArray(type)) {
    return type.some((candidate) => matchesSingleType(candidate, value));
  }
  return matchesSingleType(type, value);
}

function includesType(type: unknown, candidate: string): boolean {
  if (type === undefined) return true;
  return Array.isArray(type) ? type.includes(candidate) : type === candidate;
}

function matchesSingleType(type: unknown, value: unknown): boolean {
  switch (type) {
    case "object":
      return isPlainObject(value);
    case "array":
      return Array.isArray(value);
    case "string":
      return typeof value === "string";
    case "number":
    case "integer":
      return typeof value === "number";
    case "boolean":
      return typeof value === "boolean";
    case "null":
      return value === null;
    default:
      // Unknown/unsupported schema type keyword — don't fail closed on
      // something this minimal validator doesn't understand.
      return true;
  }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function describeType(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  return typeof value;
}
