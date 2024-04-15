import { IContext } from '../types';
import { getConfig } from '../config';

const config = getConfig();

export interface ConnectionInfo {
  port: number;
  database: string;
  schema: string;
  username: string;
  password: string;
}

export class ConnectionInfoResolver {
  constructor() {
    this.connectionInfo = this.connectionInfo.bind(this);
  }

  public async connectionInfo(
    _root: any,
    _args: any,
    ctx: IContext,
  ): Promise<ConnectionInfo> {
    const project = await ctx.projectService.getCurrentProject();

    return {
      port: 7432,
      database: project.catalog,
      schema: project.schema,
      username: config.pgUsername,
      password: config.pgPassword,
    };
  }
}
