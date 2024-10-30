import { IContext } from '@server/types';
import { getConfig } from '@server/config';

import { getLogger } from '@server/utils';
import { uniq } from 'lodash';

const config = getConfig();

const logger = getLogger('LearingResolver');
logger.level = 'debug';

export class LearningResolver {
  constructor() {
    this.getLearningRecord = this.getLearningRecord.bind(this);
    this.saveLearningRecord = this.saveLearningRecord.bind(this);
  }

  public async getLearningRecord(
    _root: any,
    _args: any,
    ctx: IContext,
  ): Promise<any> {
    const result = await ctx.learningRepository.findAll();
    return { paths: result[0]?.paths || [] };
  }

  public async saveLearningRecord(
    _root: any,
    args: any,
    ctx: IContext,
  ): Promise<any> {
    const { path } = args.data;
    const result = await ctx.learningRepository.findAll();

    if (!result.length) {
      return await ctx.learningRepository.createOne({
        userId: config?.userUUID,
        paths: [path],
      });
    }

    const [record] = result;
    return await ctx.learningRepository.updateOne(record.id, {
      userId: config?.userUUID,
      paths: uniq([...record.paths, path]),
    });
  }
}
