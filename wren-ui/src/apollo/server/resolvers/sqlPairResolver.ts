import { IContext } from '@server/types/context';
import { SqlPair } from '@server/repositories';
import * as Errors from '@server/utils/error';
export class SqlPairResolver {
  constructor() {
    this.getProjectSqlPairs = this.getProjectSqlPairs.bind(this);
    this.createSqlPair = this.createSqlPair.bind(this);
    this.updateSqlPair = this.updateSqlPair.bind(this);
    this.deleteSqlPair = this.deleteSqlPair.bind(this);
    this.generateQuestion = this.generateQuestion.bind(this);
  }

  public async getProjectSqlPairs(
    _root: unknown,
    _arg: any,
    ctx: IContext,
  ): Promise<SqlPair[]> {
    const project = await ctx.projectService.getCurrentProject();
    return ctx.sqlPairService.getProjectSqlPairs(project.id);
  }

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
    const project = await ctx.projectService.getCurrentProject();
    await this.validateSql(arg.data.sql, ctx);
    return await ctx.sqlPairService.createSqlPair(project.id, arg.data);
  }

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
    const project = await ctx.projectService.getCurrentProject();
    await this.validateSql(arg.data.sql, ctx);
    return ctx.sqlPairService.editSqlPair(project.id, arg.where.id, arg.data);
  }

  public async deleteSqlPair(
    _root: unknown,
    arg: {
      where: {
        id: number;
      };
    },
    ctx: IContext,
  ): Promise<boolean> {
    const project = await ctx.projectService.getCurrentProject();
    return ctx.sqlPairService.deleteSqlPair(project.id, arg.where.id);
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
    const project = await ctx.projectService.getCurrentProject();
    const questions = await ctx.sqlPairService.generateQuestions(project, [
      arg.data.sql,
    ]);
    return questions[0];
  }

  private async validateSql(sql: string, ctx: IContext) {
    const project = await ctx.projectService.getCurrentProject();
    const lastDeployment = await ctx.deployService.getLastDeployment(
      project.id,
    );
    const manifest = lastDeployment.manifest;
    try {
      await ctx.queryService.preview(sql, {
        manifest,
        project,
        dryRun: true,
      });
    } catch (err) {
      throw Errors.create(Errors.GeneralErrorCodes.INVALID_SQL_ERROR, {
        customMessage: err.message,
      });
    }
  }
}
