/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = function (knex) {
  return knex.schema.alterTable('dashboard', function (table) {
    table.boolean('cache_enabled').defaultTo(true);
    table.string('schedule_frequency').nullable().defaultTo('NEVER'); // Weekly, Daily, Custom, Never
    table.string('schedule_cron').nullable().defaultTo(null); // cron expression string
    table.string('schedule_timezone').nullable().defaultTo(null);
    table.timestamp('next_scheduled_at').nullable().defaultTo(null); // Next scheduled run timestamp
  });
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = function (knex) {
  return knex.schema.alterTable('dashboard', function (table) {
    table.dropColumn('cache_enabled');
    table.dropColumn('schedule_frequency');
    table.dropColumn('schedule_cron');
    table.dropColumn('schedule_timezone');
    table.dropColumn('next_scheduled_at');
  });
};
