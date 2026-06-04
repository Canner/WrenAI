/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = async function (knex) {
  await knex.schema.alterTable('project', (table) => {
    table
      .string('project_type')
      .notNullable()
      .defaultTo('CLASSIC')
      .comment('Workspace project type, either AGENTIC or CLASSIC');
    table
      .boolean('is_current')
      .notNullable()
      .defaultTo(false)
      .comment('Whether this project is the active project in the workspace');
  });

  const projects = await knex('project').select('id').orderBy('id', 'asc');
  if (projects.length > 0) {
    await knex('project').update({ is_current: false });
    await knex('project').where({ id: projects[0].id }).update({ is_current: true });
  }
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = async function (knex) {
  await knex.schema.alterTable('project', (table) => {
    table.dropColumn('project_type');
    table.dropColumn('is_current');
  });
};
