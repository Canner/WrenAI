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
  openaiGenerationModel?: string;

  // encryption
  encryptionPassword: string;
  encryptionSalt: string;

  // username and password
  pgUsername?: string;
  pgPassword?: string;

  // telemetry
  telemetryEnabled?: boolean;
  posthogApiKey?: string;
  posthogHost?: string;
  userUUID?: string;

  // versions
  wrenUIVersion?: string;
  wrenEngineVersion?: string;
  wrenAIVersion?: string;
  wrenProductVersion?: string;
}

const defaultConfig = {
  // database
  dbType: 'sqlite',

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
  openaiGenerationModel: process.env.OPENAI_GENERATION_MODEL,

  // encryption
  encryptionPassword: process.env.ENCRYPTION_PASSWORD,
  encryptionSalt: process.env.ENCRYPTION_SALT,

  // username and password
  pgUsername: process.env.PG_USERNAME,
  pgPassword: process.env.PG_PASSWORD,

  // telemetry
  telemetryEnabled:
    process.env.TELEMETRY_ENABLED &&
    process.env.TELEMETRY_ENABLED.toLocaleLowerCase() === 'true',
  posthogApiKey: process.env.POSTHOG_API_KEY,
  posthogHost: process.env.POSTHOG_HOST,
  userUUID: process.env.USER_UUID,

  // versions
  wrenUIVersion: process.env.WREN_UI_VERSION,
  wrenEngineVersion: process.env.WREN_ENGINE_VERSION,
  wrenAIVersion: process.env.WREN_AI_SERVICE_VERSION,
  wrenProductVersion: process.env.WREN_PRODUCT_VERSION,
};

export function getConfig(): IConfig {
  return { ...defaultConfig, ...pickBy(config) };
}
