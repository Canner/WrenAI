// The four answer.evidence.* kinds are what a result's evidence may tell the planner about how it
// was checked. This file permits all of them; a policy preset narrows with a forbid per kind.
permit(principal, action, resource)
when { principal.project == resource.project && (
  (action == Service::Action::"invoke_component" && ["orders", "data_worker"].contains(resource.name)) ||
  (action == Service::Action::"invoke_tool" && ["read_metadata", "capabilities", "close_session", "run_sql", "open_session", "ask_data", "continue_task", "get_evidence", "list_context", "select_context", "read_context", "clarify", "describe_data"].contains(resource.name)) ||
  action == Service::Action::"execute_query" ||
  (action == Service::Action::"receive_metadata" && (principal.role == "worker" || ["schema.structure", "schema.descriptions", "knowledge.rules"].contains(resource.kind))) ||
  (action == Service::Action::"receive_answer" && resource.kind == "answer.approved" && resource.name == "orders" && resource.recipient == principal.caller) ||
  (action == Service::Action::"receive_answer" && resource.kind == "answer.sql_result" && resource.recipient == principal.caller) ||
  (action == Service::Action::"receive_answer" && resource.kind == "answer.description" && resource.recipient == principal.caller) ||
  (action == Service::Action::"receive_answer" && ["answer.evidence.checks", "answer.evidence.checks_summary", "answer.evidence.observed", "answer.evidence.unverified"].contains(resource.kind) && resource.name == "orders" && resource.recipient == principal.caller)
) };
