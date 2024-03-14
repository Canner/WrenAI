import { IContext } from '../types';
import { getLogger } from '@/apollo/server/utils';

const logger = getLogger('ModelResolver');
logger.level = 'debug';

export class ModelResolver {
  constructor() {
    this.listModels = this.listModels.bind(this);
  }

  public async listModels(_root: any, _args: any, ctx: IContext) {
    const project = await this.getCurrentProject(ctx);
    const projectId = project.id;
    const models = await ctx.modelRepository.findAllBy({ projectId });
    const modelIds = models.map((m) => m.id);
    const modelColumns = await ctx.modelColumnRepository.findColumnsByModelIds(
      modelIds
    );
    const result = [];
    for (const model of models) {
      result.push({
        ...model,
        columns: modelColumns
          .filter((c) => c.modelId === model.id)
          .map((c) => {
            c.properties = JSON.parse(c.properties);
            return c;
          }),
        properties: {
          ...JSON.parse(model.properties),
          displayName: model.name,
        },
      });
    }
    return result;
  }

  private async getCurrentProject(ctx: IContext) {
    const projects = await ctx.projectRepository.findAll({
      order: 'id',
      limit: 1,
    });
    if (!projects.length) {
      throw new Error('No project found');
    }
    return projects[0];
  }
}
