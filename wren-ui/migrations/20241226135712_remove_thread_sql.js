/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = async function (knex) {
  // drop foreign key constraint before altering column type to prevent data loss
  await knex.schema.alterTable('thread_response', (table) => {
    table.dropForeign('thread_id');
  });
  await knex.schema.alterTable('thread', (table) => {
    table.dropColumn('sql');
  });
  await knex.schema.alterTable('thread_response', (table) => {
    table.foreign('thread_id').references('thread.id').onDelete('CASCADE');
  });
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = async function (knex) {
  await knex.schema.alterTable('thread', (table) => {
    table.text('sql').nullable();
  });
};
