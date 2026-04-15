exports.up = async function (knex) {
  await knex.schema.alterTable('dashboard', (table) => {
    table.integer('project_id').nullable().alter();
  });
};

exports.down = async function (_knex) {};
