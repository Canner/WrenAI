exports.up = async function (knex) {
  await knex.raw(`
    UPDATE kb_snapshot AS ks
    SET legacy_project_id = NULL
    WHERE ks.legacy_project_id IS NOT NULL
      AND EXISTS (
        SELECT 1
        FROM deploy_log AS dl
        WHERE dl.kb_snapshot_id = ks.id
      )
      AND NOT EXISTS (
        SELECT 1
        FROM deploy_log AS dl
        WHERE dl.kb_snapshot_id = ks.id
          AND ks.deploy_hash IS NOT NULL
          AND dl.hash IS NOT NULL
          AND ks.deploy_hash <> dl.hash
      )
      AND NOT EXISTS (
        SELECT 1
        FROM dashboard AS d
        LEFT JOIN deploy_log AS dl
          ON dl.kb_snapshot_id = ks.id
        WHERE d.kb_snapshot_id = ks.id
          AND (
            (d.project_id IS NULL AND COALESCE(dl.project_id, ks.legacy_project_id) IS NOT NULL)
            OR (
              COALESCE(dl.hash, dl.deploy_hash) IS NOT NULL
              AND d.deploy_hash IS NOT NULL
              AND d.deploy_hash <> COALESCE(dl.hash, dl.deploy_hash)
            )
          )
      )
  `);
};

exports.down = async function (_knex) {};
