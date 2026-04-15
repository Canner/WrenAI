/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = async function (knex) {
  await knex.raw(`
    COMMENT ON TABLE skill_binding IS
    'Legacy compatibility table. V2 runtime ownership moved to skill_definition; do not add new runtime fields here.';
  `);
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = async function (knex) {
  await knex.raw(`
    COMMENT ON TABLE skill_binding IS NULL;
  `);
};
