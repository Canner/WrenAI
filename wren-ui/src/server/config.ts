import { pickBy } from 'lodash';

export interface IConfig {
  // wren ui
  otherServiceUsingDocker: boolean;

  // database
  pgUrl?: string;
  debug?: boolean;

  persistCredentialDir?: string;

  // wren engine
  wrenEngineEndpoint: string;

  // wren AI
  wrenAIEndpoint: string;
  generationModel?: string;

  // ibis server
  experimentalEngineRustVersion?: boolean;
  ibisServerEndpoint: string;

  // trino federation runtime
  trinoCatalogDir?: string;
  trinoCatalogManagement?: 'static' | 'dynamic';
  trinoCatalogManagementHost?: string;
  trinoCatalogManagementPort?: number;
  trinoCatalogManagementSsl?: boolean;
  trinoRuntimeHost?: string;
  trinoRuntimePort?: number;
  trinoRuntimeUser?: string;
  trinoRuntimePassword?: string;
  trinoRuntimeSsl?: boolean;

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

  // background tracker scope
  backgroundTrackerWorkspaceId?: string;
}

const defaultConfig = {
  // wren ui
  otherServiceUsingDocker: false,

  // database
  pgUrl: 'postgres://postgres:postgres@127.0.0.1:9432/wrenai',
  debug: false,

  persistCredentialDir: `${process.cwd()}/.tmp`,

  // wren engine
  wrenEngineEndpoint: 'http://localhost:8080',

  // wren AI
  wrenAIEndpoint: 'http://127.0.0.1:5555',

  // ibis server
  experimentalEngineRustVersion: true,
  ibisServerEndpoint: 'http://127.0.0.1:8000',

  // trino federation runtime
  trinoCatalogDir: `${process.cwd()}/.trino/catalog`,
  trinoCatalogManagement: 'static' as const,
  trinoCatalogManagementHost: '127.0.0.1',
  trinoCatalogManagementPort: 8081,
  trinoCatalogManagementSsl: false,
  trinoRuntimeHost: '127.0.0.1',
  trinoRuntimePort: 8081,
  trinoRuntimeUser: 'wrenai',
  trinoRuntimePassword: '',
  trinoRuntimeSsl: false,

  // encryption
  encryptionPassword: 'sementic',
  encryptionSalt: 'layer',
};

const config = {
  // node
  otherServiceUsingDocker: process.env.OTHER_SERVICE_USING_DOCKER === 'true',

  // database
  pgUrl: process.env.PG_URL,
  debug: process.env.DEBUG === 'true',

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

  // trino federation runtime
  trinoCatalogDir:
    process.env.TRINO_CATALOG_DIR || process.env.NEXT_PUBLIC_TRINO_CATALOG_DIR,
  trinoCatalogManagement:
    process.env.TRINO_CATALOG_MANAGEMENT?.toLowerCase() === 'dynamic'
      ? 'dynamic'
      : process.env.TRINO_CATALOG_MANAGEMENT?.toLowerCase() === 'static'
        ? 'static'
        : undefined,
  trinoCatalogManagementHost: process.env.TRINO_CATALOG_MANAGEMENT_HOST,
  trinoCatalogManagementPort: process.env.TRINO_CATALOG_MANAGEMENT_PORT
    ? parseInt(process.env.TRINO_CATALOG_MANAGEMENT_PORT)
    : undefined,
  trinoCatalogManagementSsl:
    process.env.TRINO_CATALOG_MANAGEMENT_SSL &&
    process.env.TRINO_CATALOG_MANAGEMENT_SSL.toLowerCase() === 'true',
  trinoRuntimeHost: process.env.TRINO_RUNTIME_HOST,
  trinoRuntimePort: process.env.TRINO_RUNTIME_PORT
    ? parseInt(process.env.TRINO_RUNTIME_PORT)
    : undefined,
  trinoRuntimeUser: process.env.TRINO_RUNTIME_USER,
  trinoRuntimePassword: process.env.TRINO_RUNTIME_PASSWORD,
  trinoRuntimeSsl:
    process.env.TRINO_RUNTIME_SSL &&
    process.env.TRINO_RUNTIME_SSL.toLowerCase() === 'true',

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

  // background tracker scope
  backgroundTrackerWorkspaceId:
    process.env.BACKGROUND_TRACKER_WORKSPACE_ID || undefined,
};

export function getConfig(): IConfig {
  return { ...defaultConfig, ...pickBy(config) };
}
