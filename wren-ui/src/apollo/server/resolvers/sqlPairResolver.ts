import { IContext } from '@server/types/context';
import { SqlPair } from '../repositories';
import * as Errors from '@server/utils/error';
export class SqlPairResolver {
  constructor() {
    this.getProjectSqlPairs = this.getProjectSqlPairs.bind(this);
    this.createSqlPair = this.createSqlPair.bind(this);
    this.editSqlPair = this.editSqlPair.bind(this);
    this.deleteSqlPair = this.deleteSqlPair.bind(this);
    this.generateQuestion = this.generateQuestion.bind(this);
  }

  public async getProjectSqlPairs(
    _root: any,
    _arg: any,
    ctx: IContext,
  ): Promise<SqlPair[]> {
    const project = await ctx.projectService.getCurrentProject();
    return ctx.sqlPairService.getProjectSqlPairs(project.id);
  }

  public async createSqlPair(
    _root: any,
    arg: {
      data: {
        sql: string;
        question: string;
      };
    },
    ctx: IContext,
  ) {
    const project = await ctx.projectService.getCurrentProject();

    // dry run the sql to check if it's valid
    const lastDeployment = await ctx.deployService.getLastDeployment(
      project.id,
    );
    const manifest = lastDeployment.manifest;
    try {
      await ctx.queryService.preview(arg.data.sql, {
        manifest,
        project,
        dryRun: true,
      });
    } catch (err) {
      throw Errors.create(Errors.GeneralErrorCodes.INVALID_SQL_ERROR, {
        customMessage: err.message,
      });
    }

    const sqlPairs = await ctx.sqlPairService.createSqlPairs(project.id, [
      arg.data,
    ]);
    return sqlPairs[0];
  }

  public async editSqlPair(
    _root: any,
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
  ) {
    const project = await ctx.projectService.getCurrentProject();

    // dry run the sql to check if it's valid
    const lastDeployment = await ctx.deployService.getLastDeployment(
      project.id,
    );
    const manifest = lastDeployment.manifest;
    try {
      await ctx.queryService.preview(arg.data.sql, {
        manifest,
        project,
        dryRun: true,
      });
    } catch (err) {
      throw Errors.create(Errors.GeneralErrorCodes.INVALID_SQL_ERROR, {
        customMessage: err.message,
      });
    }

    return ctx.sqlPairService.editSqlPair(project.id, arg.where.id, arg.data);
  }

  public async deleteSqlPair(
    _root: any,
    arg: {
      where: {
        id: number;
      };
    },
    ctx: IContext,
  ) {
    const project = await ctx.projectService.getCurrentProject();
    return ctx.sqlPairService.deleteSqlPair(project.id, arg.where.id);
  }

  public async generateQuestion(
    _root: any,
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
}
