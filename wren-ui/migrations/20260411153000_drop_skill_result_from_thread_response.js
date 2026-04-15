/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = async function (knex) {
  const hasColumn = await knex.schema.hasColumn('thread_response', 'skill_result');

  if (!hasColumn) {
    return;
  }

  await knex.schema.alterTable('thread_response', (table) => {
    table.dropColumn('skill_result');
  });
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = async function (knex) {
  const hasColumn = await knex.schema.hasColumn('thread_response', 'skill_result');

  if (hasColumn) {
    return;
  }

  await knex.schema.alterTable('thread_response', (table) => {
    table.jsonb('skill_result').nullable();
  });
};
