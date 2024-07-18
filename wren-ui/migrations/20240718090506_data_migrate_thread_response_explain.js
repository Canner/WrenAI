/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = async function (knex) {
  const threadResponses = await knex('thread_response').select('*');
  if (threadResponses.length === 0) {
    return;
  }
  const explainData = threadResponses.map((threadResponse) => {
    const error =
      process.env.DB_TYPE === 'pg'
        ? 'error'
        : JSON.stringify({
            code: 'OLD_VERSION',
            message: 'created before version 0.8.0',
          });
    return {
      thread_response_id: threadResponse.id,
      status: 'failed',
      error,
    };
  });

  await knex('thread_response_explain').insert(explainData);
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = async function (knex) {
  // remove all data
  await knex('thread_response_explain').delete();
};
