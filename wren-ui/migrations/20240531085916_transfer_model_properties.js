/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = async function (knex) {
  const projects = await knex('project').select('*');
  const models = await knex('model').select('*');
  console.log(`model len:${models.length}`);
  for (const model of models) {
    const project = projects.find((p) => p.id === model.project_id);
    const dataSourceType = project.type;
    // get schema & catalog if its available
    let schema = null;
    let catalog = null;
    let table = null;
    switch (dataSourceType) {
      case 'BIG_QUERY': {
        const connectionInfo =
          typeof project.connection_info === 'string'
            ? JSON.parse(project.connection_info)
            : project.connection_info;
        const datasetId = connectionInfo.datasetId;
        if (!datasetId) continue;
        const splitDataSetId = datasetId.split('.');
        schema = splitDataSetId[1];
        catalog = splitDataSetId[0];
        table = model.source_table_name;
        break;
      }
      case 'POSTGRES': {
        const connectionInfo =
          typeof project.connection_info === 'string'
            ? JSON.parse(project.connection_info)
            : project.connection_info;
        catalog = connectionInfo.database;
        schema = model.source_table_name.split('.')[0];
        table = model.source_table_name.split('.')[1];
        break;
      }
      case 'DUCKDB': {
        // already have schema & catalog in properties
        table = model.source_table_name;
        break;
      }
    }
    const oldProperties = model.properties ? JSON.parse(model.properties) : {};
    const newProperties = {
      schema,
      catalog,
      table,
      ...oldProperties,
    };
    await knex('model')
      .where({ id: model.id })
      .update({ properties: JSON.stringify(newProperties) });
  }
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = function () {
  return Promise.resolve();
};
