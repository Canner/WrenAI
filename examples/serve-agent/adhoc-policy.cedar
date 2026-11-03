// The four answer.evidence.* kinds are permitted here; a policy preset narrows with a forbid per kind.
// Task, private SQL execution, metadata and result disclosure are separate gates. Which
// models and columns exist, and which are denied, is the Wren project's business.
permit(principal, action, resource)
when { principal.project == resource.project && (
  (action == Service::Action::"invoke_component" && ["analytics", "data_worker"].contains(resource.name)) ||
  (action == Service::Action::"invoke_tool" && ["capabilities", "open_session", "ask_data", "continue_task", "get_evidence", "read_metadata", "close_session"].contains(resource.name)) ||
  (action == Service::Action::"invoke_tool" && principal.role == "worker" && ["run_sql", "list_context", "select_context", "read_context", "clarify", "describe_data"].contains(resource.name)) ||
  (action == Service::Action::"receive_metadata" && principal.role == "worker") ||
  (action == Service::Action::"receive_answer" && resource.kind == "answer.approved" && resource.name == "analytics" && resource.recipient == principal.caller) ||
  (action == Service::Action::"receive_answer" && resource.kind == "answer.description" && resource.recipient == principal.caller) ||
  (action == Service::Action::"receive_answer" && ["answer.evidence.checks", "answer.evidence.checks_summary", "answer.evidence.observed", "answer.evidence.unverified"].contains(resource.kind) && resource.name == "analytics" && resource.recipient == principal.caller)
) };
permit(principal, action, resource)
when { principal.project == resource.project && (
  (action == Service::Action::"execute_query" && principal.role == "worker") ||
  (action == Service::Action::"receive_answer" && resource.kind == "answer.sql_result" && resource.recipient == principal.caller)
) };
