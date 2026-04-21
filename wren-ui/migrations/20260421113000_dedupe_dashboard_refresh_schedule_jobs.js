/**
 * @param {import('knex').Knex} knex
 */
exports.up = async function up(knex) {
  const duplicateGroups = await knex('schedule_job')
    .select('target_type', 'target_id')
    .where('target_type', 'dashboard_refresh')
    .groupBy('target_type', 'target_id')
    .havingRaw('COUNT(*) > 1');

  for (const group of duplicateGroups) {
    const jobs = await knex('schedule_job')
      .where({
        target_type: group.target_type,
        target_id: group.target_id,
      })
      .orderBy('updated_at', 'desc')
      .orderBy('created_at', 'desc')
      .orderBy('id', 'desc');

    const [primaryJob, ...duplicateJobs] = jobs;
    if (!primaryJob || duplicateJobs.length === 0) {
      continue;
    }

    const duplicateIds = duplicateJobs.map((job) => job.id);
    await knex('schedule_job_run')
      .whereIn('schedule_job_id', duplicateIds)
      .update({ schedule_job_id: primaryJob.id });
    await knex('schedule_job').whereIn('id', duplicateIds).delete();
  }

  await knex.raw(`
    CREATE UNIQUE INDEX schedule_job_dashboard_refresh_target_unique
    ON schedule_job (target_type, target_id)
    WHERE target_type = 'dashboard_refresh'
  `);
};

/**
 * @param {import('knex').Knex} knex
 */
exports.down = async function down(knex) {
  await knex.raw(`
    DROP INDEX IF EXISTS schedule_job_dashboard_refresh_target_unique
  `);
};
