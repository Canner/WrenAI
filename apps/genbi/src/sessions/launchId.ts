/**
 * Creates the browser action identifier used to make a native-session launch
 * idempotent at the BFF boundary. `randomUUID()` is restricted to secure
 * contexts in some browsers, while `getRandomValues()` remains available for
 * a trusted LAN origin, so construct the same RFC 4122 v4 identifier when the
 * convenience API is absent.
 */
export interface NativeSessionLaunchEntropy {
  readonly randomUUID?: () => string;
  readonly getRandomValues?: (values: Uint8Array<ArrayBuffer>) => void;
}

export class NativeSessionLaunchIdError extends Error {
  constructor() {
    super('This browser cannot create a secure session action. Reload in a supported browser and try again.');
    this.name = 'NativeSessionLaunchIdError';
  }
}

function browserEntropy(): NativeSessionLaunchEntropy {
  const browserCrypto = globalThis.crypto;
  return {
    ...(typeof browserCrypto?.randomUUID === 'function' ? { randomUUID: () => browserCrypto.randomUUID() } : {}),
    ...(typeof browserCrypto?.getRandomValues === 'function' ? { getRandomValues: (values) => { browserCrypto.getRandomValues(values); } } : {}),
  };
}

function hex(value: number): string {
  return value.toString(16).padStart(2, '0');
}

/**
 * The optional entropy argument keeps the non-secure-context fallback
 * deterministic in tests without ever falling back to Math.random in the
 * product. The BFF continues to validate the resulting UUID unchanged.
 */
export function createNativeSessionLaunchId(entropy: NativeSessionLaunchEntropy = browserEntropy()): string {
  if (entropy.randomUUID) return entropy.randomUUID();
  if (!entropy.getRandomValues) throw new NativeSessionLaunchIdError();

  const values = new Uint8Array(new ArrayBuffer(16));
  entropy.getRandomValues(values);
  values[6] = (values[6]! & 0x0f) | 0x40;
  values[8] = (values[8]! & 0x3f) | 0x80;
  const parts = [...values].map(hex);
  return `${parts.slice(0, 4).join('')}-${parts.slice(4, 6).join('')}-${parts.slice(6, 8).join('')}-${parts.slice(8, 10).join('')}-${parts.slice(10, 16).join('')}`;
}
