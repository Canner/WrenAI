/**
 * A native PTY capability belongs to this browser session, not to the durable
 * server record. sessionStorage permits a reload/reconnect in this tab while
 * making a new browser session truthfully report that it cannot attach.
 */
const prefix = 'wren-genbi-native-session-capability:';
const recoveryPrefix = 'wren-genbi-native-session-recovery-capability:';
const returnSourcePrefix = 'wren-genbi-native-session-return-source:';
export type NativeSessionReturnSource = 'setup' | 'context';

function storage(): Storage | undefined {
  try { return typeof window === 'undefined' ? undefined : window.sessionStorage; } catch { return undefined; }
}

export function nativeSessionCapability(id: string): string | undefined {
  return storage()?.getItem(`${prefix}${id}`) ?? undefined;
}

export function saveNativeSessionCapability(id: string, capability: string): void {
  storage()?.setItem(`${prefix}${id}`, capability);
}

export function clearNativeSessionCapability(id: string): void {
  storage()?.removeItem(`${prefix}${id}`);
}

/** A distinct action secret; it is never accepted for PTY attachment. */
export function nativeSetupRecoveryCapability(id: string): string | undefined {
  return storage()?.getItem(`${recoveryPrefix}${id}`) ?? undefined;
}

export function saveNativeSetupRecoveryCapability(id: string, capability: string): void {
  storage()?.setItem(`${recoveryPrefix}${id}`, capability);
}

export function clearNativeSetupRecoveryCapability(id: string): void {
  storage()?.removeItem(`${recoveryPrefix}${id}`);
}

/** Bounded navigation intent belongs to this browser tab, never the durable server row. */
export function nativeSessionReturnSource(id: string): NativeSessionReturnSource | undefined {
  const value = storage()?.getItem(`${returnSourcePrefix}${id}`);
  return value === 'setup' || value === 'context' ? value : undefined;
}

export function saveNativeSessionReturnSource(id: string, source: NativeSessionReturnSource): void {
  storage()?.setItem(`${returnSourcePrefix}${id}`, source);
}

export function clearNativeSessionReturnSource(id: string): void {
  storage()?.removeItem(`${returnSourcePrefix}${id}`);
}
