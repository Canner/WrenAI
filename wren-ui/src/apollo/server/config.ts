import { pickBy } from 'lodash';
import path from 'path';

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

  // sql protocol port
  sqlProtocolPort?: number;

  // username and password
  username?: string;
  password?: string;

  // accounts config file path
  accountsConfigFilepath?: string;
}

const defaultConfig = {
  // database
  dbType: 'pg',

  // pg
  pgUrl: 'postgres://postgres:postgres@localhost:5432/admin_ui',
  debug: false,

  // sqlite
  sqliteFile: './db.sqlite3',

  persistCredentialDir: `${process.cwd()}/.tmp`,

  // wren engine
  wrenEngineEndpoint: 'http://localhost:8080',

  // wren AI
  wrenAIEndpoint: 'http://localhost:5555',

  // encryption
  encryptionPassword: 'sementic',
  encryptionSalt: 'layer',

  // sql protocol port
  sqlProtocolPort: 7432,

  // username and password
  username: 'wren-admin',
  password: 'wren-admin-password',

  // accounts config file path
  accountsConfigFilepath: path.resolve(
    process.cwd(),
    '../docker/data/etc/accounts',
  ),
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

  // sql protocol port
  sqlProtocolPort: parseInt(process.env.SQL_PROTOCOL_PORT, 10),

  // username and password
  username: process.env.ADMIN_USERNAME,
  password: process.env.ADMIN_PASSWORD,

  // accounts config file path
  accountsConfigFilepath: process.env.ACCOUNTS_CONFIG_FILEPATH,
};

export function getConfig(): IConfig {
  return { ...defaultConfig, ...pickBy(config) };
}
