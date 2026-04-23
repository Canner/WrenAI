/**
 * @param { import('knex').Knex } knex
 * @returns { Promise<void> }
 */
exports.up = async function (knex) {
  await knex.raw(`
    UPDATE dashboard AS d
    SET workspace_id = kb.workspace_id
    FROM knowledge_base AS kb
    WHERE d.workspace_id IS NULL
      AND d.knowledge_base_id IS NOT NULL
      AND d.knowledge_base_id = kb.id
      AND kb.workspace_id IS NOT NULL
  `);
};

/**
 * @param { import('knex').Knex } knex
 * @returns { Promise<void> }
 */
exports.down = async function (_knex) {};
