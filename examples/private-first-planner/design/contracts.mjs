import { immutable, requireThat, digest } from '../contracts.mjs';
const obj = properties => ({ type: 'object', properties, required: Object.keys(properties), additionalProperties: false });
export const codeSchema = immutable(obj({
  version: { type: 'integer', enum: [1] },
  export_id: { type: 'string', pattern: '^[a-f0-9-]{36}$' },
  data_version: { type: 'string', pattern: '^[a-f0-9]{64}$' },
  html: { type: 'string', minLength: 1, maxLength: 20000 },
  css: { type: 'string', minLength: 1, maxLength: 20000 },
  javascript: { type: 'string', minLength: 1, maxLength: 20000 },
}));
export function validateCode(spec, bundle) {
  requireThat(spec && Object.getPrototypeOf(spec) === Object.prototype
    && Object.keys(spec).sort().join(',') === Object.keys(codeSchema.properties).sort().join(',')
    && spec.version === 1 && spec.export_id === bundle.export_id && spec.data_version === bundle.data_version
    && digest(bundle.payload) === bundle.data_version && Buffer.byteLength(JSON.stringify(spec)) <= 64 * 1024);
  for (const key of ['html', 'css', 'javascript']) requireThat(typeof spec[key] === 'string' && spec[key].trim().length > 0 && spec[key].length <= 20000);
  // These structural checks do not claim to sanitize JavaScript. Only the isolated
  // browser runner may execute it; the shared gallery contains screenshots only.
  requireThat(!/<\s*\/?\s*(script|style|iframe|frame|object|embed|link|meta|base|form|html|head|body)\b/i.test(spec.html)
    && !/\son[a-z]+\s*=/i.test(spec.html) && !/<\/style/i.test(spec.css) && !/<\/script/i.test(spec.javascript));
  return immutable(spec);
}
