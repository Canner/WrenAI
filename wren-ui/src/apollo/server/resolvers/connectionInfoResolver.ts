import { IContext } from '../types';
import { getConfig } from '../config';
import { isEmpty } from 'lodash';

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
    const { accounts } = await ctx.configService.getAccountsConfig();

    // validate accounts
    if (isEmpty(accounts)) {
      throw new Error('No accounts found');
    }

    return {
      port: config.sqlProtocolPort,
      database: project.catalog,
      schema: project.schema,
      username: accounts[0].username,
      password: accounts[0].password,
    };
  }
}
