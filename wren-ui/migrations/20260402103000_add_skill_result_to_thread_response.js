/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = async function (knex) {
  await knex.schema.alterTable('thread_response', (table) => {
    table.jsonb('skill_result').nullable();
  });

  const threadResponses = await knex('thread_response as tr')
    .leftJoin('asking_task as at', 'at.id', 'tr.asking_task_id')
    .select('tr.id', 'tr.skill_result as skillResult', 'at.detail');

  for (const response of threadResponses) {
    if (response.skillResult) {
      continue;
    }

    const detail =
      typeof response.detail === 'string'
        ? JSON.parse(response.detail)
        : response.detail;
    const skillResult = detail?.skillResult || detail?.skill_result;

    if (!skillResult) {
      continue;
    }

    await knex('thread_response')
      .where({ id: response.id })
      .update({
        skill_result: JSON.stringify(skillResult),
      });
  }
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = async function (knex) {
  await knex.schema.alterTable('thread_response', (table) => {
    table.dropColumn('skill_result');
  });
};
