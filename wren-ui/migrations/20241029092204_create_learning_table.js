/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = function (knex) {
  return knex.schema.createTable('learning', (table) => {
    table.increments('id').comment('ID');
    table.string('user_id').comment('The user uuid.');
    table
      .text('paths')
      .comment(
        'The learning paths of user, array of learning stories, [enum1, enum2, ..enum(n)].',
      );
  });
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = function (knex) {
  return knex.schema.dropTable('learning');
};
