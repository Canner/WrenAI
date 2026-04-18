import process from 'process';
import { getConfig } from '../src/server/config';
import { SecretRepository } from '../src/server/repositories/secretRepository';
import {
  SecretReencryptOptions,
  reencryptSecrets,
} from '../src/server/services/secretReencrypt';
import { SecretService } from '../src/server/services/secretService';
import { bootstrapKnex } from '../src/server/utils/knex';

export interface CliOptions extends SecretReencryptOptions {
  help?: boolean;
}

const HELP_TEXT = `Usage: yarn re-encrypt-secrets --target-key-version <n> [options]

Options:
  --target-key-version <n>   Required. New key_version written to secret_record.
  --source-key-version <n>   Optional. Only re-encrypt records currently on this key_version.
  --workspace-id <id>        Optional. Only re-encrypt one workspace.
  --scope-type <type>        Optional. Only re-encrypt one scope_type.
  --execute                  Persist changes. Default is dry-run.
  --dry-run                  Preview only. This is the default.
  --help                     Show this message.

Environment:
  SOURCE_ENCRYPTION_PASSWORD / SOURCE_ENCRYPTION_SALT   Optional source master key.
  TARGET_ENCRYPTION_PASSWORD / TARGET_ENCRYPTION_SALT   Optional target master key.
  ENCRYPTION_PASSWORD / ENCRYPTION_SALT                 Fallback for source/target when TARGET_/SOURCE_ are absent.
`;

const readValue = (args: string[], index: number, flag: string) => {
  const value = args[index + 1];
  if (!value || value.startsWith('--')) {
    throw new Error(`${flag} requires a value`);
  }
  return value;
};

export const parseCliArgs = (argv: string[]): CliOptions => {
  const options: CliOptions = {
    execute: false,
    targetKeyVersion: Number.NaN,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    switch (arg) {
      case '--execute':
        options.execute = true;
        break;
      case '--dry-run':
        options.execute = false;
        break;
      case '--target-key-version':
        options.targetKeyVersion = Number(
          readValue(argv, index, '--target-key-version'),
        );
        index += 1;
        break;
      case '--source-key-version':
        options.sourceKeyVersion = Number(
          readValue(argv, index, '--source-key-version'),
        );
        index += 1;
        break;
      case '--workspace-id':
        options.workspaceId = readValue(argv, index, '--workspace-id');
        index += 1;
        break;
      case '--scope-type':
        options.scopeType = readValue(argv, index, '--scope-type');
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

  if (
    !options.help &&
    (!Number.isInteger(options.targetKeyVersion) ||
      options.targetKeyVersion < 1)
  ) {
    throw new Error('--target-key-version must be a positive integer');
  }

  if (
    options.sourceKeyVersion !== undefined &&
    (!Number.isInteger(options.sourceKeyVersion) ||
      options.sourceKeyVersion < 1)
  ) {
    throw new Error('--source-key-version must be a positive integer');
  }

  return options;
};

const resolveSecretMaterial = () => {
  const config = getConfig();

  const sourcePassword =
    process.env.SOURCE_ENCRYPTION_PASSWORD || config.encryptionPassword;
  const sourceSalt =
    process.env.SOURCE_ENCRYPTION_SALT || config.encryptionSalt;
  const targetPassword =
    process.env.TARGET_ENCRYPTION_PASSWORD || config.encryptionPassword;
  const targetSalt =
    process.env.TARGET_ENCRYPTION_SALT || config.encryptionSalt;

  if (!sourcePassword || !sourceSalt || !targetPassword || !targetSalt) {
    throw new Error(
      'Missing encryption material. Set ENCRYPTION_PASSWORD/ENCRYPTION_SALT or SOURCE_/TARGET_ overrides.',
    );
  }

  return {
    sourcePassword,
    sourceSalt,
    targetPassword,
    targetSalt,
  };
};

export const runCli = async (argv: string[]) => {
  const options = parseCliArgs(argv);
  if (options.help) {
    console.log(HELP_TEXT);
    return;
  }

  const config = getConfig();
  const knex = bootstrapKnex({
    pgUrl: config.pgUrl,
    debug: config.debug,
  });

  try {
    const secretRepository = new SecretRepository(knex);
    const { sourcePassword, sourceSalt, targetPassword, targetSalt } =
      resolveSecretMaterial();

    const summary = await reencryptSecrets(
      {
        secretRepository,
        sourceSecretService: new SecretService({
          secretRepository,
          encryptionPassword: sourcePassword,
          encryptionSalt: sourceSalt,
        }),
        targetSecretService: new SecretService({
          secretRepository,
          encryptionPassword: targetPassword,
          encryptionSalt: targetSalt,
        }),
      },
      options,
    );

    console.log(JSON.stringify(summary, null, 2));
  } finally {
    await knex.destroy();
  }
};

if (require.main === module) {
  runCli(process.argv.slice(2)).catch((error) => {
    console.error(`re_encrypt_secrets failed: ${error.message}`);
    process.exitCode = 1;
  });
}
