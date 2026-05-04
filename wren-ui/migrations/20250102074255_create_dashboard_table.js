/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = async function (knex) {
  await knex.schema.createTable('dashboard', (table) => {
    table.increments('id').primary();
    table
      .integer('project_id')
      .notNullable()
      .comment('Reference to project.id');
    table.string('name').notNullable().comment('The dashboard name');

    table.foreign('project_id').references('project.id').onDelete('CASCADE');
    table.index(['project_id']);
    table.timestamps(true, true);
  });

  await knex.transaction(async (trx) => {
    // select all existing projects, should be only one project though
    const projects = await knex('project').forUpdate();
    if (projects.length > 0) {
      const dashboards = projects.map((project) => ({
        project_id: project.id,
        name: 'Dashboard',
      }));
      await trx('dashboard').insert(dashboards);
    }
  });
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = function (knex) {
  return knex.schema.dropTable('dashboard');
};
