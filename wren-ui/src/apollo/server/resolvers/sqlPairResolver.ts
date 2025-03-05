import { IContext } from '@server/types/context';
import { SqlPair } from '../repositories';

export class SqlPairResolver {
  constructor() {
    this.getProjectSqlPairs = this.getProjectSqlPairs.bind(this);
    this.createSqlPairs = this.createSqlPairs.bind(this);
    this.editSqlPair = this.editSqlPair.bind(this);
    this.deleteSqlPair = this.deleteSqlPair.bind(this);
  }

  public async getProjectSqlPairs(
    _root: any,
    _arg: any,
    ctx: IContext,
  ): Promise<SqlPair[]> {
    const project = await ctx.projectService.getCurrentProject();
    return ctx.sqlPairService.getProjectSqlPairs(project.id);
  }

  public async createSqlPairs(
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
    return ctx.sqlPairService.createSqlPairs(project.id, [arg.data]);
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
}
