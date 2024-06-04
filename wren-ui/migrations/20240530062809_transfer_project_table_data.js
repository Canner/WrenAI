/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = async function (knex) {
  const projects = await knex('project').select('*');

  // bigquery data
  const bigqueryConnectionInfo = projects
    .filter((project) => project.type === 'BIG_QUERY')
    .map((project) => {
      return {
        id: project.id,
        connectionInfo: {
          projectId: project.project_id,
          datasetId: project.dataset_id,
          credentials: project.credentials,
        },
      };
    });

  // duckdb data
  const duckdbConnectionInfo = projects
    .filter((project) => project.type === 'DUCKDB')
    .map((project) => {
      return {
        id: project.id,
        connectionInfo: {
          initSql: project.init_sql || '',
          configurations: project.configurations || {},
          extensions: project.extensions || [],
        },
      };
    });

  // postgres data
  const postgresConnectionInfo = projects
    .filter((project) => project.type === 'POSTGRES')
    .map((project) => {
      const ssl =
        project.configurations && project.configurations.ssl ? true : false;
      return {
        id: project.id,
        connectionInfo: {
          host: project.host,
          port: project.port,
          database: project.database,
          user: project.user,
          password: project.credentials,
          ssl,
        },
      };
    });

  // update project table
  for (const project of [
    ...bigqueryConnectionInfo,
    ...duckdbConnectionInfo,
    ...postgresConnectionInfo,
  ]) {
    const { id, connectionInfo } = project;
    if (process.env.DB_TYPE === 'pg') {
      // postgres
      await knex('project')
        .where({ id })
        .update({ connection_info: connectionInfo });
    } else {
      // sqlite
      await knex('project')
        .where({ id })
        .update({ connection_info: JSON.stringify(connectionInfo) });
    }
  }
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = async function (knex) {
  await knex('project').update({ connection_info: null });
};
