/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = async function (knex) {
  const trx = await knex.transaction();
  try {
    await trx.raw('PRAGMA foreign_keys = OFF');
    await trx.raw('ALTER TABLE thread DROP COLUMN sql');
    await trx.raw('PRAGMA foreign_keys = ON');
    await trx.commit();
  } catch (e) {
    await trx.rollback();
    throw e;
  }
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
