exports.up = async function (knex) {
  await knex.schema.alterTable('relation', (table) => {
    table.dropUnique(['name'], 'relation_name_unique');
  });
};

exports.down = async function (knex) {
  await knex.schema.alterTable('relation', (table) => {
    table.unique(['name'], { indexName: 'relation_name_unique' });
  });
};
