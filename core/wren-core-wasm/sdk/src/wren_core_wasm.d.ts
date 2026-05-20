/**
 * Type declarations for wasm-pack generated bindings (--target web).
 *
 * Hand-maintained to match the Rust #[wasm_bindgen] API in src/lib.rs.
 * After `wasm-pack build`, full generated types are in pkg/wren_core_wasm.d.ts.
 */

export class WrenEngine {
  free(): void;
  constructor();
  registerJson(table_name: string, json_data: string): Promise<void>;
  registerParquet(table_name: string, data: Uint8Array): Promise<void>;
  registerCsv(
    table_name: string,
    data: Uint8Array,
    options_json: string,
  ): Promise<void>;
  loadMDL(mdl_json: string, source: string): Promise<void>;
  query(sql: string): Promise<string>;
  cubeQuery(cube_query_json: string): Promise<string>;
  listCubes(): string;
}

export type InitInput =
  | RequestInfo
  | URL
  | Response
  | BufferSource
  | WebAssembly.Module;

export default function init(
  module_or_path?:
    | { module_or_path: InitInput | Promise<InitInput> }
    | InitInput
    | Promise<InitInput>
): Promise<void>;
