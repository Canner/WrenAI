/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = async function (knex) {
  await knex.schema.alterTable('dashboard', (table) => {
    table.boolean('is_default').notNullable().defaultTo(false);
  });

  const dashboards = await knex('dashboard')
    .select('id', 'project_id', 'knowledge_base_id')
    .orderBy('id', 'asc');

  const initializedScopes = new Set();

  for (const dashboard of dashboards) {
    const scopeKey = dashboard.knowledge_base_id
      ? `kb:${dashboard.knowledge_base_id}`
      : `project:${dashboard.project_id ?? 'none'}`;

    if (initializedScopes.has(scopeKey)) {
      continue;
    }

    initializedScopes.add(scopeKey);
    await knex('dashboard').where({ id: dashboard.id }).update({
      is_default: true,
    });
  }
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = async function (knex) {
  await knex.schema.alterTable('dashboard', (table) => {
    table.dropColumn('is_default');
  });
};
