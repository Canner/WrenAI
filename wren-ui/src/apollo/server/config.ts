import { pickBy } from 'lodash';

export interface IConfig {
  // database
  dbType: string;
  // pg
  pgUrl?: string;
  debug?: boolean;
  // sqlite
  sqliteFile?: string;

  persistCredentialDir?: string;

  // wren engine
  wrenEngineEndpoint: string;

  // wren AI
  wrenAIEndpoint: string;

  // encryption
  encryptionPassword: string;
  encryptionSalt: string;
}

const defaultConfig = {
  // database
  dbType: 'pg',

  // pg
  pgUrl: 'postgres://postgres:postgres@localhost:5432/admin_ui',
  debug: false,

  // sqlite
  sqliteFile: './db.sqlite3',

  persistCredentialDir: process.cwd(),

  // wren engine
  wrenEngineEndpoint: 'http://localhost:8080',

  // wren AI
  wrenAIEndpoint: 'http://localhost:5000',

  // encryption
  encryptionPassword: 'sementic',
  encryptionSalt: 'layer',
};

const config = {
  // database
  dbType: process.env.DB_TYPE,
  // pg
  pgUrl: process.env.PG_URL,
  debug: process.env.DEBUG === 'true',
  // sqlite
  sqliteFile: process.env.SQLITE_FILE,

  persistCredentialDir: (() => {
    if (
      process.env.PERSIST_CREDENTIAL_DIR &&
      process.env.PERSIST_CREDENTIAL_DIR.length > 0
    ) {
      return process.env.PERSIST_CREDENTIAL_DIR;
    }
    return undefined;
  })(),

  // wren engine
  wrenEngineEndpoint: process.env.WREN_ENGINE_ENDPOINT,

  // wren AI
  wrenAIEndpoint: process.env.WREN_AI_ENDPOINT,

  // encryption
  encryptionPassword: process.env.ENCRYPTION_PASSWORD,
  encryptionSalt: process.env.ENCRYPTION_SALT,
};

export function getConfig(): IConfig {
  return { ...defaultConfig, ...pickBy(config) };
}
