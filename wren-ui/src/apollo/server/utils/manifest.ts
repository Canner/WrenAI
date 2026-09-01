import type { Manifest } from '@server/mdl/type';

const normalizeColumns = <T extends { name?: string }>(columns?: T[]) => {
  if (!Array.isArray(columns)) {
    return columns;
  }

  const seen = new Set<string>();
  return columns.filter((column) => {
    const name = column?.name;
    if (!name) {
      return true;
    }

    const normalizedName = name.toLowerCase();
    if (seen.has(normalizedName)) {
      return false;
    }

    seen.add(normalizedName);
    return true;
  });
};

export function normalizeManifest(manifest: Manifest): Manifest;
export function normalizeManifest(manifest: undefined): undefined;
export function normalizeManifest(manifest?: Manifest): Manifest | undefined {
  if (!manifest?.models) {
    return manifest;
  }

  return {
    ...manifest,
    models: manifest.models.map((model) => ({
      ...model,
      columns: normalizeColumns(model.columns),
    })),
  };
}

export const encodeManifest = (manifest: Manifest): string =>
  Buffer.from(JSON.stringify(normalizeManifest(manifest))).toString('base64');
