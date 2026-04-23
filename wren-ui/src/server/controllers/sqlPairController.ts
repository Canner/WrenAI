import { IContext } from '@server/types/context';
import { SqlPair } from '@server/repositories';
import { toPersistedRuntimeIdentity } from '@server/context/runtimeScope';
import { toPersistedRuntimeIdentityPatch } from '@server/utils/persistedRuntimeIdentity';
import * as Errors from '@server/utils/error';
import { TelemetryEvent, TrackTelemetry } from '@server/telemetry/telemetry';
import { DialectSQL, WrenSQL } from '@server/models/adaptor';
import { safeFormatSQL } from '@server/utils/sqlFormat';
import { validateSql as validateSqlWithExecutionContext } from '@server/utils/apiUtils';
import {
  assertLatestExecutableRuntimeScope,
  resolveRuntimeExecutionContext,
  resolveRuntimeProject,
} from '@server/utils/runtimeExecutionContext';
import {
  assertAuthorizedWithAudit,
  buildAuthorizationActorFromRuntimeScope,
  recordAuditEvent,
} from '@server/authz';

const getCurrentPersistedRuntimeIdentity = (ctx: IContext) =>
  toPersistedRuntimeIdentityPatch(
    toPersistedRuntimeIdentity(ctx.runtimeScope!),
  );

const getKnowledgeBaseAuthorizationTarget = (ctx: IContext) => {
  const workspaceId = ctx.runtimeScope?.workspace?.id || null;
  const knowledgeBase = ctx.runtimeScope?.knowledgeBase;

  return {
    actor:
      ctx.authorizationActor ||
      buildAuthorizationActorFromRuntimeScope(ctx.runtimeScope),
    resource: {
      resourceType: knowledgeBase ? 'knowledge_base' : 'workspace',
      resourceId: knowledgeBase?.id || workspaceId,
      workspaceId,
      attributes: {
        workspaceKind: ctx.runtimeScope?.workspace?.kind || null,
        knowledgeBaseKind: knowledgeBase?.kind || null,
      },
    },
  };
};

const requireKnowledgeBaseWriteAccess = async (ctx: IContext) => {
  const { actor, resource } = getKnowledgeBaseAuthorizationTarget(ctx);
  await assertAuthorizedWithAudit({
    auditEventRepository: ctx.auditEventRepository,
    actor,
    action: 'knowledge_base.update',
    resource,
  });
};

const requireKnowledgeBaseReadAccess = async (ctx: IContext) => {
  const { actor, resource } = getKnowledgeBaseAuthorizationTarget(ctx);
  await assertAuthorizedWithAudit({
    auditEventRepository: ctx.auditEventRepository,
    actor,
    action: 'knowledge_base.read',
    resource,
  });
  return { actor, resource };
};

export class SqlPairController {
  constructor() {
    this.getProjectSqlPairs = this.getProjectSqlPairs.bind(this);
    this.createSqlPair = this.createSqlPair.bind(this);
    this.updateSqlPair = this.updateSqlPair.bind(this);
    this.deleteSqlPair = this.deleteSqlPair.bind(this);
    this.generateQuestion = this.generateQuestion.bind(this);
    this.modelSubstitute = this.modelSubstitute.bind(this);
  }

  public async getProjectSqlPairs(
    _root: unknown,
    _arg: any,
    ctx: IContext,
  ): Promise<SqlPair[]> {
    const { actor, resource } = await requireKnowledgeBaseReadAccess(ctx);
    const sqlPairs = await ctx.sqlPairService.listSqlPairs(
      getCurrentPersistedRuntimeIdentity(ctx),
    );
    await recordAuditEvent({
      auditEventRepository: ctx.auditEventRepository,
      actor,
      action: 'knowledge_base.read',
      resource,
      result: 'allowed',
      payloadJson: {
        operation: 'get_project_sql_pairs',
      },
    });
    return sqlPairs;
  }

  @TrackTelemetry(TelemetryEvent.KNOWLEDGE_CREATE_SQL_PAIR)
  public async createSqlPair(
    _root: unknown,
    arg: {
      data: {
        sql: string;
        question: string;
      };
    },
    ctx: IContext,
  ): Promise<SqlPair> {
    await requireKnowledgeBaseWriteAccess(ctx);
    await this.validateSql(arg.data.sql, ctx);
    const created = await ctx.sqlPairService.createSqlPair(
      getCurrentPersistedRuntimeIdentity(ctx),
      arg.data,
    );
    const { actor, resource } = getKnowledgeBaseAuthorizationTarget(ctx);
    await recordAuditEvent({
      auditEventRepository: ctx.auditEventRepository,
      actor,
      action: 'knowledge_base.update',
      resource: {
        ...resource,
        resourceType: 'sql_pair',
        resourceId: created.id,
      },
      result: 'succeeded',
      afterJson: created as any,
      payloadJson: {
        operation: 'create_sql_pair',
      },
    });
    return created;
  }

  @TrackTelemetry(TelemetryEvent.KNOWLEDGE_UPDATE_SQL_PAIR)
  public async updateSqlPair(
    _root: unknown,
    arg: {
      data: {
        sql?: string;
        question?: string;
      };
      where: {
        id: number;
      };
    },
    ctx: IContext,
  ): Promise<SqlPair> {
    await requireKnowledgeBaseWriteAccess(ctx);
    if (arg.data.sql) {
      await this.validateSql(arg.data.sql, ctx);
    }
    const updated = await ctx.sqlPairService.updateSqlPair(
      getCurrentPersistedRuntimeIdentity(ctx),
      arg.where.id,
      arg.data,
    );
    const { actor, resource } = getKnowledgeBaseAuthorizationTarget(ctx);
    await recordAuditEvent({
      auditEventRepository: ctx.auditEventRepository,
      actor,
      action: 'knowledge_base.update',
      resource: {
        ...resource,
        resourceType: 'sql_pair',
        resourceId: arg.where.id,
      },
      result: 'succeeded',
      afterJson: updated as any,
      payloadJson: {
        operation: 'update_sql_pair',
      },
    });
    return updated;
  }

  @TrackTelemetry(TelemetryEvent.KNOWLEDGE_DELETE_SQL_PAIR)
  public async deleteSqlPair(
    _root: unknown,
    arg: {
      where: {
        id: number;
      };
    },
    ctx: IContext,
  ): Promise<boolean> {
    await this.assertExecutableRuntimeScope(ctx);
    await requireKnowledgeBaseWriteAccess(ctx);
    const deleted = await ctx.sqlPairService.deleteSqlPair(
      getCurrentPersistedRuntimeIdentity(ctx),
      arg.where.id,
    );
    const { actor, resource } = getKnowledgeBaseAuthorizationTarget(ctx);
    await recordAuditEvent({
      auditEventRepository: ctx.auditEventRepository,
      actor,
      action: 'knowledge_base.update',
      resource: {
        ...resource,
        resourceType: 'sql_pair',
        resourceId: arg.where.id,
      },
      result: 'succeeded',
      payloadJson: {
        operation: 'delete_sql_pair',
      },
    });
    return deleted;
  }

  public async generateQuestion(
    _root: unknown,
    arg: {
      data: {
        sql: string;
      };
    },
    ctx: IContext,
  ) {
    const { actor, resource } = await requireKnowledgeBaseReadAccess(ctx);
    const project = await this.getActiveRuntimeProject(ctx);
    const questions = await ctx.sqlPairService.generateQuestions(project, [
      arg.data.sql,
    ]);
    await recordAuditEvent({
      auditEventRepository: ctx.auditEventRepository,
      actor,
      action: 'knowledge_base.read',
      resource,
      result: 'allowed',
      payloadJson: {
        operation: 'generate_question',
      },
    });
    return questions[0];
  }

  public async modelSubstitute(
    _root: unknown,
    arg: {
      data: {
        sql: DialectSQL;
      };
    },
    ctx: IContext,
  ): Promise<WrenSQL> {
    const { actor, resource } = await requireKnowledgeBaseReadAccess(ctx);
    await this.assertExecutableRuntimeScope(ctx);
    const executionContext = await resolveRuntimeExecutionContext({
      runtimeScope: ctx.runtimeScope!,
      projectService: ctx.projectService,
    });
    if (!executionContext) {
      throw Errors.create(Errors.GeneralErrorCodes.NO_DEPLOYMENT_FOUND, {
        customMessage: 'No deployment found, please deploy your project first',
      });
    }
    const { project, manifest } = executionContext;

    const wrenSQL = await ctx.sqlPairService.modelSubstitute(
      arg.data.sql as DialectSQL,
      {
        project,
        manifest,
      },
    );
    await recordAuditEvent({
      auditEventRepository: ctx.auditEventRepository,
      actor,
      action: 'knowledge_base.read',
      resource,
      result: 'allowed',
      payloadJson: {
        operation: 'model_substitute',
      },
    });
    return safeFormatSQL(wrenSQL, { language: 'postgresql' }) as WrenSQL;
  }

  private async validateSql(sql: string, ctx: IContext) {
    try {
      await this.assertExecutableRuntimeScope(ctx);
      const executionContext = await resolveRuntimeExecutionContext({
        runtimeScope: ctx.runtimeScope!,
        projectService: ctx.projectService,
      });
      if (!executionContext) {
        throw new Error(
          'No deployment found, please deploy your project first',
        );
      }
      await validateSqlWithExecutionContext(
        sql,
        executionContext,
        ctx.queryService,
      );
    } catch (err) {
      throw Errors.create(Errors.GeneralErrorCodes.INVALID_SQL_ERROR, {
        customMessage: err instanceof Error ? err.message : String(err),
      });
    }
  }

  public getSqlPairNestedResolver = () => ({
    createdAt: (sqlPair: SqlPair, _args: any, _ctx: IContext) => {
      return new Date(sqlPair.createdAt || Date.now()).toISOString();
    },
    updatedAt: (sqlPair: SqlPair, _args: any, _ctx: IContext) => {
      return new Date(sqlPair.updatedAt || Date.now()).toISOString();
    },
  });

  private async getActiveRuntimeProject(ctx: IContext) {
    await this.assertExecutableRuntimeScope(ctx);
    const project = await resolveRuntimeProject(
      ctx.runtimeScope!,
      ctx.projectService,
    );
    if (!project) {
      throw Errors.create(Errors.GeneralErrorCodes.NO_DEPLOYMENT_FOUND, {
        customMessage: 'No deployment found, please deploy your project first',
      });
    }

    return project;
  }

  private async assertExecutableRuntimeScope(ctx: IContext) {
    try {
      await assertLatestExecutableRuntimeScope({
        runtimeScope: ctx.runtimeScope!,
        knowledgeBaseRepository: ctx.knowledgeBaseRepository,
        kbSnapshotRepository: ctx.kbSnapshotRepository,
      });
    } catch (error) {
      throw Errors.create(Errors.GeneralErrorCodes.OUTDATED_RUNTIME_SNAPSHOT, {
        customMessage:
          error instanceof Error ? error.message : 'Snapshot outdated',
      });
    }
  }
}
