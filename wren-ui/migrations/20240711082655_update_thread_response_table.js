/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = function (knex) {
  knex.table('thread_response').alterTable((table) => {
    table
      .jsonb('corrections')
      .nullable()
      .comment('the corrections of the previous thread response'); // [{type, id, correct}, ...]
  });
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = function (knex) {
  knex.table('thread_response').alterTable((table) => {
    table.dropColumn('corrections');
  });
};
