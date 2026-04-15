/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = async function (knex) {
  await knex.schema.alterTable('skill_definition', (table) => {
    table.string('secret_record_id').nullable();
    table
      .foreign('secret_record_id')
      .references('id')
      .inTable('secret_record')
      .onDelete('SET NULL');
    table.index(['secret_record_id']);
  });
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = async function (knex) {
  await knex.schema.alterTable('skill_definition', (table) => {
    table.dropIndex(['secret_record_id']);
    table.dropForeign(['secret_record_id']);
    table.dropColumn('secret_record_id');
  });
};
