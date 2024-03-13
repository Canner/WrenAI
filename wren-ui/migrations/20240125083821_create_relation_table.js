/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = function (knex) {
  return knex.schema.createTable('relation', (table) => {
    table.increments('id').comment('ID');
    table.integer('project_id').comment('Reference to project.id');
    table.string('name').comment('relation name').unique();
    table
      .string('join_type')
      .comment('join type, eg:"ONE_TO_ONE", "ONE_TO_MANY", "MANY_TO_ONE"');
    table
      .integer('left_column_id')
      .comment(
        'left column id, "{leftSideColumn} {joinType} {rightSideColumn}"'
      );
    table
      .integer('right_column_id')
      .comment(
        'right column id, "{leftSideColumn} {joinType} {rightSideColumn}"'
      );
    table.timestamps(true, true);
  });
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = function (knex) {
  return knex.schema.dropTable('relation');
};
