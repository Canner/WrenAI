/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = function (knex) {
  return knex.schema.createTable('organization', (table) => {
    table.increments('id').comment('ID');
    table.string('name').notNullable().comment('Organization display name');
    table
      .string('identifier')
      .notNullable()
      .unique()
      .comment('Organization identifier used in selectors and APIs');
    table
      .text('description')
      .nullable()
      .comment('Optional organization description');
    table
      .boolean('is_current')
      .notNullable()
      .defaultTo(false)
      .comment('Whether the organization is currently selected');
    table.timestamps(true, true);
  });
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = function (knex) {
  return knex.schema.dropTable('organization');
};
