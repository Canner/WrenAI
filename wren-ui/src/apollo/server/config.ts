import { pickBy } from 'lodash';

export interface IConfig {
  // wren ui
  otherServiceUsingDocker: boolean;

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
  generationModel?: string;

  // ibis server
  experimentalEngineRustVersion?: boolean;
  ibisServerEndpoint: string;

  // encryption
  encryptionPassword: string;
  encryptionSalt: string;

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

  // generate recommendation questions max categories
  projectRecommendationQuestionMaxCategories?: number;
  projectRecommendationQuestionsMaxQuestions?: number;
  threadRecommendationQuestionMaxCategories?: number;
  threadRecommendationQuestionsMaxQuestions?: number;
}

const defaultConfig = {
  // wren ui
  otherServiceUsingDocker: false,

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

  // ibis server
  experimentalEngineRustVersion: false,
  ibisServerEndpoint: 'http://127.0.0.1:8000',

  // encryption
  encryptionPassword: 'sementic',
  encryptionSalt: 'layer',
};

const config = {
  // node
  otherServiceUsingDocker: process.env.OTHER_SERVICE_USING_DOCKER === 'true',

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
  generationModel: process.env.GENERATION_MODEL,

  // ibis server
  experimentalEngineRustVersion:
    process.env.EXPERIMENTAL_ENGINE_RUST_VERSION === 'true',
  ibisServerEndpoint: process.env.IBIS_SERVER_ENDPOINT,

  // encryption
  encryptionPassword: process.env.ENCRYPTION_PASSWORD,
  encryptionSalt: process.env.ENCRYPTION_SALT,

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

  // generate recommendation questions max questions
  projectRecommendationQuestionMaxCategories: process.env
    .PROJECT_RECOMMENDATION_QUESTION_MAX_CATEGORIES
    ? parseInt(process.env.PROJECT_RECOMMENDATION_QUESTION_MAX_CATEGORIES)
    : 3,
  projectRecommendationQuestionsMaxQuestions: process.env
    .PROJECT_RECOMMENDATION_QUESTIONS_MAX_QUESTIONS
    ? parseInt(process.env.PROJECT_RECOMMENDATION_QUESTIONS_MAX_QUESTIONS)
    : 3,
  threadRecommendationQuestionMaxCategories: process.env
    .THREAD_RECOMMENDATION_QUESTION_MAX_CATEGORIES
    ? parseInt(process.env.THREAD_RECOMMENDATION_QUESTION_MAX_CATEGORIES)
    : 3,
  threadRecommendationQuestionsMaxQuestions: process.env
    .THREAD_RECOMMENDATION_QUESTIONS_MAX_QUESTIONS
    ? parseInt(process.env.THREAD_RECOMMENDATION_QUESTIONS_MAX_QUESTIONS)
    : 1,
};

export function getConfig(): IConfig {
  return { ...defaultConfig, ...pickBy(config) };
}
