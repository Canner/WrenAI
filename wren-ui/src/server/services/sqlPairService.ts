import { SqlPair } from '@server/repositories';
import { IWrenAIAdaptor } from '@server/adaptors/wrenAIAdaptor';
import { ISqlPairRepository } from '@server/repositories/sqlPairRepository';
import { PersistedRuntimeIdentity } from '@server/context/runtimeScope';
import { getLogger } from '@server/utils';
import { chunk } from 'lodash';
import * as Errors from '@server/utils/error';
import { Project } from '../repositories';
import { IIbisAdaptor } from '../adaptors/ibisAdaptor';
import { toPersistedRuntimeIdentityPatch } from '@server/utils/persistedRuntimeIdentity';
import {
  AskRuntimeIdentity,
  DialectSQL,
  WrenSQL,
  WrenAILanguage,
  SqlPairResult,
  SqlPairStatus,
  QuestionsResult,
  QuestionsStatus,
} from '../models/adaptor';
import { Manifest } from '@server/mdl/type';
import { DataSourceName } from '@server/types';

const logger = getLogger('SqlPairService');

const toErrorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

export interface CreateSqlPair {
  sql: string;
  question: string;
}

export interface EditSqlPair {
  sql?: string;
  question?: string;
}

export interface ModelSubstituteOptions {
  project: Project;
  // if not given, will use the deployed manifest
  manifest: Manifest;
}

export interface ISqlPairService {
  listSqlPairs(runtimeIdentity: PersistedRuntimeIdentity): Promise<SqlPair[]>;
  getSqlPair(
    runtimeIdentity: PersistedRuntimeIdentity,
    sqlPairId: number,
  ): Promise<SqlPair | null>;
  createSqlPair(
    runtimeIdentity: PersistedRuntimeIdentity,
    sqlPair: CreateSqlPair,
  ): Promise<SqlPair>;
  createSqlPairs(
    runtimeIdentity: PersistedRuntimeIdentity,
    sqlPairs: CreateSqlPair[],
  ): Promise<SqlPair[]>;
  updateSqlPair(
    runtimeIdentity: PersistedRuntimeIdentity,
    sqlPairId: number,
    sqlPair: EditSqlPair,
  ): Promise<SqlPair>;
  deleteSqlPair(
    runtimeIdentity: PersistedRuntimeIdentity,
    sqlPairId: number,
  ): Promise<boolean>;
  generateQuestions(project: Project, sqls: string[]): Promise<string[]>;
  modelSubstitute(
    sql: DialectSQL,
    options: ModelSubstituteOptions,
  ): Promise<WrenSQL>;
}

export class SqlPairService implements ISqlPairService {
  private sqlPairRepository: ISqlPairRepository;
  private wrenAIAdaptor: IWrenAIAdaptor;
  private ibisAdaptor: IIbisAdaptor;

  constructor({
    sqlPairRepository,
    wrenAIAdaptor,
    ibisAdaptor,
  }: {
    sqlPairRepository: ISqlPairRepository;
    wrenAIAdaptor: IWrenAIAdaptor;
    ibisAdaptor: IIbisAdaptor;
  }) {
    this.sqlPairRepository = sqlPairRepository;
    this.wrenAIAdaptor = wrenAIAdaptor;
    this.ibisAdaptor = ibisAdaptor;
  }

  public async modelSubstitute(
    sql: DialectSQL,
    options: ModelSubstituteOptions,
  ): Promise<WrenSQL> {
    const { manifest: mdl, project } = options;
    const { type: connectionType, connectionInfo } = project;
    if (connectionType === DataSourceName.DUCKDB) {
      // engine does not implement model substitute.
      throw Errors.create(Errors.GeneralErrorCodes.IBIS_SERVER_ERROR, {
        customMessage: 'DuckDB connection does not support model substitute.',
      });
    }
    // Prefer the runtime project's default binding; fall back to the first
    // model's table reference for legacy/single-source manifests.
    const firstModel = mdl.models?.[0];
    const catalog = project.catalog || firstModel?.tableReference?.catalog;
    const schema = project.schema || firstModel?.tableReference?.schema;
    return await this.ibisAdaptor.modelSubstitute(sql, {
      dataSource: connectionType,
      connectionInfo,
      mdl,
      catalog,
      schema,
    });
  }

  public async generateQuestions(
    project: Project,
    sqls: string[],
  ): Promise<string[]> {
    try {
      const language =
        (project.language &&
          WrenAILanguage[project.language as keyof typeof WrenAILanguage]) ||
        WrenAILanguage.EN;
      const configurations = {
        language,
      };

      const { queryId } = await this.wrenAIAdaptor.generateQuestions({
        configurations,
        sqls,
        runtimeIdentity: this.toAskRuntimeIdentity({ projectId: project.id }),
      });
      const result = await this.waitQuestionGenerateResult(queryId);
      if (result.error) {
        throw Errors.create(Errors.GeneralErrorCodes.GENERATE_QUESTIONS_ERROR, {
          customMessage: result.error.message,
        });
      }
      return result.questions || [];
    } catch (err) {
      throw Errors.create(Errors.GeneralErrorCodes.GENERATE_QUESTIONS_ERROR, {
        customMessage: toErrorMessage(err),
      });
    }
  }

  public async listSqlPairs(
    runtimeIdentity: PersistedRuntimeIdentity,
  ): Promise<SqlPair[]> {
    return this.sqlPairRepository.findAllByRuntimeIdentity(runtimeIdentity);
  }

  public async getSqlPair(
    runtimeIdentity: PersistedRuntimeIdentity,
    sqlPairId: number,
  ): Promise<SqlPair | null> {
    return this.sqlPairRepository.findOneByIdWithRuntimeIdentity(
      sqlPairId,
      runtimeIdentity,
    );
  }

  public async createSqlPair(
    runtimeIdentity: PersistedRuntimeIdentity,
    sqlPair: CreateSqlPair,
  ): Promise<SqlPair> {
    const tx = await this.sqlPairRepository.transaction();
    try {
      const newPair = await this.sqlPairRepository.createOne(
        {
          ...sqlPair,
          ...toPersistedRuntimeIdentityPatch(runtimeIdentity),
        },
        { tx },
      );
      const { queryId } = await this.wrenAIAdaptor.deploySqlPair({
        runtimeIdentity: this.toAskRuntimeIdentity(runtimeIdentity),
        sqlPair: newPair,
      });
      const deployResult = await this.waitUntilSqlPairResult(queryId);
      if (deployResult.error) {
        throw Errors.create(deployResult.error.code, {
          customMessage: deployResult.error.message,
        });
      }
      await tx.commit();
      return newPair;
    } catch (error) {
      await tx.rollback();
      throw error;
    }
  }

  public async createSqlPairs(
    runtimeIdentity: PersistedRuntimeIdentity,
    sqlPairs: CreateSqlPair[],
  ): Promise<SqlPair[]> {
    const tx = await this.sqlPairRepository.transaction();
    const newPairs = await this.sqlPairRepository.createMany(
      sqlPairs.map((pair) => ({
        ...pair,
        ...toPersistedRuntimeIdentityPatch(runtimeIdentity),
      })),
      { tx },
    );
    // batch parall process with size of 10
    const successPairIds: number[] = [];
    const errorPairs: Array<{ id: number; question: string; message: string }> =
      [];
    const chunks = chunk(newPairs, 10);
    for (const pairs of chunks) {
      await Promise.allSettled(
        pairs.map(async (pair) => {
          const { queryId } = await this.wrenAIAdaptor.deploySqlPair({
            runtimeIdentity: this.toAskRuntimeIdentity(runtimeIdentity),
            sqlPair: pair,
          });
          const deployResult = await this.waitUntilSqlPairResult(queryId);
          if (deployResult.error) {
            errorPairs.push({
              id: pair.id,
              question: pair.question,
              message: deployResult.error.message,
            });
            return;
          }
          successPairIds.push(pair.id);
        }),
      ).then(async (_result) => {
        if (errorPairs.length > 0) {
          logger.debug(
            `deploy sql pair failed. ${errorPairs.map((pair) => pair.question).join(', ')}`,
          );
          await tx.rollback();
          await this.wrenAIAdaptor.deleteSqlPairs({
            runtimeIdentity: this.toAskRuntimeIdentity(runtimeIdentity),
            sqlPairIds: successPairIds,
          });
          throw Errors.create(Errors.GeneralErrorCodes.DEPLOY_SQL_PAIR_ERROR, {
            customMessage: errorPairs.map((pair) => pair.message).join(', '),
          });
        }
      });
    }
    await tx.commit();
    return newPairs;
  }

  async updateSqlPair(
    runtimeIdentity: PersistedRuntimeIdentity,
    sqlPairId: number,
    sqlPair: EditSqlPair,
  ): Promise<SqlPair> {
    // First verify the SQL pair exists and belongs to the project
    const existingPair = await this.getSqlPair(runtimeIdentity, sqlPairId);
    if (!existingPair) {
      throw new Error(
        `SQL pair with ID ${sqlPairId} not found in the current runtime scope`,
      );
    }

    // Update only the provided fields
    const updatedData: Partial<SqlPair> = {
      sql: existingPair.sql,
      question: existingPair.question,
      updatedAt: new Date().toISOString(),
    };

    if (sqlPair.sql !== undefined) {
      updatedData.sql = sqlPair.sql;
    }

    if (sqlPair.question !== undefined) {
      updatedData.question = sqlPair.question;
    }
    const tx = await this.sqlPairRepository.transaction();
    try {
      const updatedSqlPair = await this.sqlPairRepository.updateOne(
        sqlPairId,
        updatedData,
        { tx },
      );
      const { queryId } = await this.wrenAIAdaptor.deploySqlPair({
        runtimeIdentity: this.toAskRuntimeIdentity(runtimeIdentity),
        sqlPair: updatedSqlPair,
      });
      const deployResult = await this.waitUntilSqlPairResult(queryId);
      if (deployResult.error) {
        throw Errors.create(Errors.GeneralErrorCodes.DEPLOY_SQL_PAIR_ERROR, {
          customMessage: deployResult.error.message,
        });
      }
      await tx.commit();
      return updatedSqlPair;
    } catch (error) {
      logger.error(`edit sql pair failed. ${error}`);
      await tx.rollback();
      throw Errors.create(Errors.GeneralErrorCodes.DEPLOY_SQL_PAIR_ERROR, {
        customMessage: toErrorMessage(error),
      });
    }
  }

  async deleteSqlPair(
    runtimeIdentity: PersistedRuntimeIdentity,
    sqlPairId: number,
  ): Promise<boolean> {
    // First verify the SQL pair exists and belongs to the project
    const existingPair = await this.getSqlPair(runtimeIdentity, sqlPairId);

    if (!existingPair) {
      throw new Error(
        `SQL pair with ID ${sqlPairId} not found in the current runtime scope`,
      );
    }
    const tx = await this.sqlPairRepository.transaction();
    try {
      await this.sqlPairRepository.deleteOne(sqlPairId, { tx });
      await this.wrenAIAdaptor.deleteSqlPairs({
        runtimeIdentity: this.toAskRuntimeIdentity(runtimeIdentity),
        sqlPairIds: [sqlPairId],
      });
      await tx.commit();
      return true;
    } catch (error) {
      logger.error(`delete sql pair failed. ${error}`);
      await tx.rollback();
      throw Errors.create(Errors.GeneralErrorCodes.DEPLOY_SQL_PAIR_ERROR, {
        customMessage: toErrorMessage(error),
      });
    }
  }

  private async waitUntilSqlPairResult(
    queryId: string,
  ): Promise<SqlPairResult> {
    let result = await this.wrenAIAdaptor.getSqlPairResult(queryId);
    while (!this.isFinishedState(result.status)) {
      await new Promise((resolve) => setTimeout(resolve, 500));
      result = await this.wrenAIAdaptor.getSqlPairResult(queryId);
    }
    return result;
  }

  private async waitQuestionGenerateResult(
    queryId: string,
  ): Promise<Partial<QuestionsResult>> {
    let result = await this.wrenAIAdaptor.getQuestionsResult(queryId);
    while (!this.isQuestionResultFinished(result.status)) {
      await new Promise((resolve) => setTimeout(resolve, 500));
      result = await this.wrenAIAdaptor.getQuestionsResult(queryId);
    }
    return result;
  }

  private isFinishedState(status: SqlPairStatus) {
    return [SqlPairStatus.FINISHED, SqlPairStatus.FAILED].includes(status);
  }

  private isQuestionResultFinished(status?: QuestionsStatus): boolean {
    return [QuestionsStatus.SUCCEEDED, QuestionsStatus.FAILED].includes(
      status as QuestionsStatus,
    );
  }

  private toAskRuntimeIdentity(
    runtimeIdentity: PersistedRuntimeIdentity,
  ): AskRuntimeIdentity {
    return {
      ...(typeof runtimeIdentity.projectId === 'number'
        ? { projectId: runtimeIdentity.projectId }
        : {}),
      ...(runtimeIdentity.workspaceId !== undefined
        ? { workspaceId: runtimeIdentity.workspaceId ?? null }
        : {}),
      ...(runtimeIdentity.knowledgeBaseId !== undefined
        ? { knowledgeBaseId: runtimeIdentity.knowledgeBaseId ?? null }
        : {}),
      ...(runtimeIdentity.kbSnapshotId !== undefined
        ? { kbSnapshotId: runtimeIdentity.kbSnapshotId ?? null }
        : {}),
      ...(runtimeIdentity.deployHash !== undefined
        ? { deployHash: runtimeIdentity.deployHash ?? null }
        : {}),
      ...(runtimeIdentity.actorUserId !== undefined
        ? { actorUserId: runtimeIdentity.actorUserId ?? null }
        : {}),
    };
  }
}
