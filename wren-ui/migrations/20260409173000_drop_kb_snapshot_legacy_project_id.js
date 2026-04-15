exports.up = async function (knex) {
  await knex.schema.alterTable('kb_snapshot', (table) => {
    table.dropColumn('legacy_project_id');
  });
};

exports.down = async function (_knex) {};
