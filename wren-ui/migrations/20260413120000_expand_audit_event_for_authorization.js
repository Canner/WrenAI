/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = async function (knex) {
  await knex.schema.alterTable('audit_event', (table) => {
    table.string('actor_type').nullable();
    table.string('actor_id').nullable();
    table.string('action').nullable();
    table.string('resource_type').nullable();
    table.string('resource_id').nullable();
    table.string('result').nullable();
    table.text('reason').nullable();
    table.jsonb('before_json').nullable();
    table.jsonb('after_json').nullable();
    table.string('request_id').nullable();
    table.string('session_id').nullable();
    table.text('ip_address').nullable();
    table.text('user_agent').nullable();

    table.index(['workspace_id', 'action'], 'audit_event_workspace_action_idx');
    table.index(['resource_type', 'resource_id'], 'audit_event_resource_idx');
    table.index(['result'], 'audit_event_result_idx');
  });
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = async function (knex) {
  await knex.schema.alterTable('audit_event', (table) => {
    table.dropIndex(['workspace_id', 'action'], 'audit_event_workspace_action_idx');
    table.dropIndex(['resource_type', 'resource_id'], 'audit_event_resource_idx');
    table.dropIndex(['result'], 'audit_event_result_idx');

    table.dropColumn('actor_type');
    table.dropColumn('actor_id');
    table.dropColumn('action');
    table.dropColumn('resource_type');
    table.dropColumn('resource_id');
    table.dropColumn('result');
    table.dropColumn('reason');
    table.dropColumn('before_json');
    table.dropColumn('after_json');
    table.dropColumn('request_id');
    table.dropColumn('session_id');
    table.dropColumn('ip_address');
    table.dropColumn('user_agent');
  });
};
