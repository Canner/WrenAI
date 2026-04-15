/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = async function (knex) {
  await knex.schema.createTable('skill_marketplace_catalog', (table) => {
    table.string('id').primary();
    table.string('slug').notNullable().unique();
    table.string('name').notNullable();
    table.text('description').nullable();
    table.string('category').nullable();
    table.string('author').nullable();
    table.string('version').notNullable().defaultTo('1.0.0');
    table.string('runtime_kind').notNullable().defaultTo('isolated_python');
    table.string('source_type').notNullable().defaultTo('inline');
    table.text('source_ref').nullable();
    table.string('entrypoint').nullable();
    table.jsonb('manifest_json').nullable();
    table.text('default_instruction').nullable();
    table
      .string('default_execution_mode')
      .notNullable()
      .defaultTo('inject_only');
    table.boolean('is_builtin').notNullable().defaultTo(false);
    table.boolean('is_featured').notNullable().defaultTo(false);
    table.integer('install_count').notNullable().defaultTo(0);
    table.timestamps(true, true);

    table.index(['is_builtin']);
    table.index(['is_featured']);
  });
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = async function (knex) {
  await knex.schema.dropTableIfExists('skill_marketplace_catalog');
};
