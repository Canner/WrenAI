import crypto from 'crypto';
import process from 'process';
import { Client } from 'pg';
import { getConfig } from '../src/server/config';
import { buildConnectorBridgeFromLegacyProject } from '../src/server/utils/connectionConnectorBridge';

interface CliOptions {
  execute: boolean;
  workspaceId?: string;
  help?: boolean;
}

interface BackfillSummary {
  execute: boolean;
  workspaceId?: string;
  scannedKnowledgeBases: number;
  eligibleKnowledgeBases: number;
  createdConnectors: number;
  linkedPrimaryConnectors: number;
  skippedKnowledgeBases: number;
  notes: string[];
}

interface KnowledgeBaseRow {
  id: string;
  workspace_id: string;
  name: string;
  created_by?: string | null;
  primary_connector_id?: string | null;
  runtime_project_id?: number | null;
  sample_dataset?: string | null;
}

interface ProjectRow {
  id: number;
  type: string;
  display_name: string;
  connection_info: Record<string, any>;
}

interface ConnectorRow {
  id: string;
  workspace_id: string;
  knowledge_base_id?: string | null;
  type: string;
  database_provider?: string | null;
  display_name: string;
}

const HELP_TEXT = `Usage: yarn ts-node scripts/backfill_legacy_projects_to_connectors.ts [options]

Options:
  --workspace <id>      Optional. Only backfill one workspace.
  --workspace-id <id>   Alias of --workspace.
  --execute             Persist changes. Default is dry-run.
  --dry-run             Preview only. This is the default.
  --help                Show this message.
`;

const DEFAULT_SECRET_KEY_VERSION = 1;
const SECRET_ENCRYPTION_ALGORITHM = 'aes-256-gcm';
const SECRET_ENCRYPTION_DIGEST = 'sha512';
const SECRET_ENCRYPTION_ITERATIONS = 100_000;
const SECRET_ENCRYPTION_KEY_LENGTH = 32;
const SECRET_ENCRYPTION_IV_LENGTH = 12;

const config = getConfig();

const readValue = (args: string[], index: number, flag: string) => {
  const value = args[index + 1];
  if (!value || value.startsWith('--')) {
    throw new Error(`${flag} requires a value`);
  }
  return value;
};

const parseCliArgs = (argv: string[]): CliOptions => {
  const options: CliOptions = { execute: false };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    switch (arg) {
      case '--execute':
        options.execute = true;
        break;
      case '--dry-run':
        options.execute = false;
        break;
      case '--workspace':
      case '--workspace-id':
        options.workspaceId = readValue(argv, index, arg);
        index += 1;
        break;
      case '--help':
      case '-h':
        options.help = true;
        break;
      default:
        throw new Error(`Unknown argument: ${arg}`);
    }
  }

  return options;
};

const buildSecretKey = (keyVersion: number) =>
  crypto.pbkdf2Sync(
    config.encryptionPassword,
    `${config.encryptionSalt}:${keyVersion}`,
    SECRET_ENCRYPTION_ITERATIONS,
    SECRET_ENCRYPTION_KEY_LENGTH,
    SECRET_ENCRYPTION_DIGEST,
  );

const encryptSecretPayload = ({
  payload,
  workspaceId,
  scopeId,
}: {
  payload: Record<string, any>;
  workspaceId: string;
  scopeId: string;
}) => {
  const aad = JSON.stringify({
    workspaceId,
    scopeType: 'connector',
    scopeId,
  });
  const iv = crypto.randomBytes(SECRET_ENCRYPTION_IV_LENGTH);
  const cipher = crypto.createCipheriv(
    SECRET_ENCRYPTION_ALGORITHM,
    buildSecretKey(DEFAULT_SECRET_KEY_VERSION),
    iv,
  );
  cipher.setAAD(Buffer.from(aad, 'utf8'));
  const ciphertext = Buffer.concat([
    cipher.update(JSON.stringify(payload), 'utf8'),
    cipher.final(),
  ]);

  return {
    ciphertext: ciphertext.toString('base64'),
    iv: iv.toString('base64'),
    authTag: cipher.getAuthTag().toString('base64'),
    aad,
    keyVersion: DEFAULT_SECRET_KEY_VERSION,
  };
};

const isInternalFederatedRuntimeProject = (project: ProjectRow) =>
  project.type === 'TRINO' && project.display_name.startsWith('[internal]');

const pickExistingConnector = ({
  knowledgeBase,
  connectors,
  project,
}: {
  knowledgeBase: KnowledgeBaseRow;
  connectors: ConnectorRow[];
  project: ProjectRow;
}) => {
  if (knowledgeBase.primary_connector_id) {
    const primaryConnector = connectors.find(
      (connector) => connector.id === knowledgeBase.primary_connector_id,
    );
    if (primaryConnector) {
      return primaryConnector;
    }
  }

  return (
    connectors.find(
      (connector) =>
        connector.display_name === project.display_name &&
        connector.type === 'database',
    ) ||
    connectors[0] ||
    null
  );
};

const main = async () => {
  const options = parseCliArgs(process.argv.slice(2));
  if (options.help) {
    console.log(HELP_TEXT);
    return;
  }

  const client = new Client({
    connectionString: config.pgUrl,
  });

  const summary: BackfillSummary = {
    execute: options.execute,
    workspaceId: options.workspaceId,
    scannedKnowledgeBases: 0,
    eligibleKnowledgeBases: 0,
    createdConnectors: 0,
    linkedPrimaryConnectors: 0,
    skippedKnowledgeBases: 0,
    notes: [],
  };

  await client.connect();

  try {
    const knowledgeBases = await client.query<KnowledgeBaseRow>(
      `
        select id, workspace_id, name, created_by, primary_connector_id, runtime_project_id, sample_dataset
        from knowledge_base
        where ($1::text is null or workspace_id = $1)
      `,
      [options.workspaceId ?? null],
    );

    summary.scannedKnowledgeBases = knowledgeBases.rows.length;

    for (const knowledgeBase of knowledgeBases.rows) {
      if (knowledgeBase.sample_dataset) {
        summary.skippedKnowledgeBases += 1;
        summary.notes.push(`skip ${knowledgeBase.name}: sample dataset KB`);
        continue;
      }

      if (!knowledgeBase.runtime_project_id) {
        summary.skippedKnowledgeBases += 1;
        summary.notes.push(`skip ${knowledgeBase.name}: no runtime project`);
        continue;
      }

      const projectResult = await client.query<ProjectRow>(
        `
          select id, type, display_name, connection_info
          from project
          where id = $1
          limit 1
        `,
        [knowledgeBase.runtime_project_id],
      );
      const project = projectResult.rows[0];

      if (!project) {
        summary.skippedKnowledgeBases += 1;
        summary.notes.push(
          `skip ${knowledgeBase.name}: runtime project ${knowledgeBase.runtime_project_id} not found`,
        );
        continue;
      }

      if (isInternalFederatedRuntimeProject(project)) {
        summary.skippedKnowledgeBases += 1;
        summary.notes.push(`skip ${knowledgeBase.name}: internal federated runtime`);
        continue;
      }

      const bridgePayload = buildConnectorBridgeFromLegacyProject(
        {
          ...project,
          displayName: project.display_name,
          connectionInfo: project.connection_info,
        } as any,
      );
      if (!bridgePayload) {
        summary.skippedKnowledgeBases += 1;
        summary.notes.push(
          `skip ${knowledgeBase.name}: project ${project.id} (${project.type}) not bridgeable`,
        );
        continue;
      }

      summary.eligibleKnowledgeBases += 1;

      const connectorResult = await client.query<ConnectorRow>(
        `
          select id, workspace_id, knowledge_base_id, type, database_provider, display_name
          from connector
          where workspace_id = $1 and knowledge_base_id = $2
          order by created_at asc nulls last, id asc
        `,
        [knowledgeBase.workspace_id, knowledgeBase.id],
      );
      let existingConnector = pickExistingConnector({
        knowledgeBase,
        connectors: connectorResult.rows,
        project,
      });

      if (!existingConnector && options.execute) {
        const connectorId = crypto.randomUUID();
        let secretRecordId: string | null = null;

        await client.query('begin');
        try {
          if (bridgePayload.secret) {
            const secretRecordIdValue = crypto.randomUUID();
            const encryptedSecret = encryptSecretPayload({
              payload: bridgePayload.secret,
              workspaceId: knowledgeBase.workspace_id,
              scopeId: connectorId,
            });
            await client.query(
              `
                insert into secret_record (
                  id, workspace_id, scope_type, scope_id, ciphertext, iv, auth_tag, aad, key_version, created_by
                ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
              `,
              [
                secretRecordIdValue,
                knowledgeBase.workspace_id,
                'connector',
                connectorId,
                encryptedSecret.ciphertext,
                encryptedSecret.iv,
                encryptedSecret.authTag,
                encryptedSecret.aad,
                encryptedSecret.keyVersion,
                knowledgeBase.created_by ?? null,
              ],
            );
            secretRecordId = secretRecordIdValue;
          }

          await client.query(
            `
              insert into connector (
                id, workspace_id, knowledge_base_id, type, database_provider, display_name, config_json, secret_record_id, created_by
              ) values ($1,$2,$3,$4,$5,$6,$7::jsonb,$8,$9)
            `,
            [
              connectorId,
              knowledgeBase.workspace_id,
              knowledgeBase.id,
              bridgePayload.type,
              bridgePayload.databaseProvider,
              bridgePayload.displayName,
              JSON.stringify(bridgePayload.config ?? {}),
              secretRecordId,
              knowledgeBase.created_by ?? null,
            ],
          );

          existingConnector = {
            id: connectorId,
            workspace_id: knowledgeBase.workspace_id,
            knowledge_base_id: knowledgeBase.id,
            type: bridgePayload.type,
            database_provider: bridgePayload.databaseProvider,
            display_name: bridgePayload.displayName,
          };

          if (!knowledgeBase.primary_connector_id) {
            await client.query(
              `
                update knowledge_base
                set primary_connector_id = $2, updated_at = now()
                where id = $1
              `,
              [knowledgeBase.id, connectorId],
            );
            summary.linkedPrimaryConnectors += 1;
          }

          await client.query('commit');
          summary.createdConnectors += 1;
          summary.notes.push(
            `created connector ${bridgePayload.displayName} for ${knowledgeBase.name}`,
          );
        } catch (error) {
          await client.query('rollback');
          throw error;
        }
      } else if (!existingConnector) {
        summary.notes.push(
          `[dry-run] would create connector ${bridgePayload.displayName} for ${knowledgeBase.name}`,
        );
      }

      const nextPrimaryConnectorId =
        knowledgeBase.primary_connector_id || existingConnector?.id || null;
      if (
        existingConnector &&
        !knowledgeBase.primary_connector_id &&
        !options.execute
      ) {
        summary.linkedPrimaryConnectors += 1;
        summary.notes.push(
          `[dry-run] would link primary connector ${nextPrimaryConnectorId} to ${knowledgeBase.name}`,
        );
      }
    }

    console.log(JSON.stringify(summary, null, 2));
  } finally {
    await client.end();
  }
};

void main().catch((error) => {
  console.error(error);
  process.exit(1);
});
