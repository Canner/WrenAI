export enum FORM_MODE {
  CREATE = 'CREATE',
  EDIT = 'EDIT',
}

// identifier separated by special & unique symbol
const specialSymbol = '☺';

export const convertObjectToIdentifier = <T>(obj: T, paths: string[]): string =>
  paths.map((path) => `${path}:${obj[path] || ''}`).join(specialSymbol);

export const convertIdentifierToObject = <T>(identifier: string): T =>
  Object.fromEntries(
    identifier.split(specialSymbol).map((str) => str.split(':')),
  );
