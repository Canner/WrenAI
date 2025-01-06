/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = async function (knex) {
  await knex.schema.createTable('dashboard', (table) => {
    table.increments('id').primary();
    table.integer('project_id').comment('Reference to project.id');
    table.string('name').comment('The dashboard name');

    table.timestamps(true, true);
  });

  // select all existing projects, should be only one project though
  const projects = await knex('project');
  if (projects.length > 0) {
    // create a dashboard for each project
    for (const project of projects) {
      await knex('dashboard').insert({
        project_id: project.id,
        name: 'Dashboard',
      });
    }
  }
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = function (knex) {
  return knex.schema.dropTable('dashboard');
};
