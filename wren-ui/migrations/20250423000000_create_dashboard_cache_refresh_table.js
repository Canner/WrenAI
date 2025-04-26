exports.up = function (knex) {
  return knex.schema.createTable('dashboard_item_refresh_job', (table) => {
    table.increments('id').primary();
    table.string('hash').notNullable().comment('uuid for the refresh job');
    table.integer('dashboard_id').notNullable();
    table.integer('dashboard_item_id').notNullable();
    table.timestamp('started_at').notNullable();
    table.timestamp('finished_at');
    table.string('status').notNullable(); // 'success', 'failed', 'in_progress'
    table.text('error_message');
    table.timestamps(true, true);

    // Foreign keys
    table
      .foreign('dashboard_id')
      .references('id')
      .inTable('dashboard')
      .onDelete('CASCADE');
    table
      .foreign('dashboard_item_id')
      .references('id')
      .inTable('dashboard_item')
      .onDelete('CASCADE');

    // Indexes
    table.index(['dashboard_id', 'created_at']);
    table.index(['dashboard_item_id', 'created_at']);
    table.index('status');
    table.index('hash');
  });
};

exports.down = function (knex) {
  return knex.schema.dropTable('dashboard_item_refresh_job');
};
