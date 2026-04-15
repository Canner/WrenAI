export enum FORM_MODE {
  CREATE = 'CREATE',
  EDIT = 'EDIT',
}

// identifier separated by special & unique symbol
const specialSymbol = '☺';

export const convertObjectToIdentifier = <T extends object>(
  obj: T,
  paths: string[],
): string =>
  paths
    .map((path) => `${path}:${(obj as Record<string, unknown>)[path] ?? ''}`)
    .join(specialSymbol);

export const convertIdentifierToObject = <T extends Record<string, string>>(
  identifier: string,
): T =>
  Object.fromEntries(
    identifier.split(specialSymbol).map((str) => str.split(':')),
  ) as T;
