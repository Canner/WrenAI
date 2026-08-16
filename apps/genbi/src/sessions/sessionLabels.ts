import type { NativeSessionPurpose, NativeSessionStatus, NativeSessionVendor } from '@/bff/client';

export const purposeLabels: Record<NativeSessionPurpose, string> = {
  analysis: 'Analyze data',
  setup: 'Set up a project',
  context_enrichment: 'Enrich context',
};

export const vendorLabels: Record<NativeSessionVendor, string> = { claude: 'Claude', codex: 'Codex' };

export const targetLabels: Record<NativeSessionVendor, string> = { claude: 'Claude CLI', codex: 'Codex CLI' };

export const statusLabels: Record<NativeSessionStatus, string> = {
  creating: 'Starting', running: 'Running', detached: 'Detached', exited: 'Exited', stopped: 'Stopped',
  interrupted: 'Unavailable', failed: 'Failed', stale: 'Stale',
};

export function relativeActivity(value: string): string {
  const delta = Math.max(0, Date.now() - new Date(value).getTime());
  const minutes = Math.floor(delta / 60_000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}
