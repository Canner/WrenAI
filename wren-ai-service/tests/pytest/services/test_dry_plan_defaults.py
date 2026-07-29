from src.web.v1.routers.sql_corrections import PostRequest
from src.web.v1.services.ask import AskRequest
from src.web.v1.services.sql_corrections import SqlCorrectionService


def test_ask_request_defaults_to_planner_validation_without_fallback():
    request = AskRequest(query="How many records are available?", id="deploy-id")

    assert request.use_dry_plan is True
    assert request.allow_dry_plan_fallback is False


def test_ask_request_allows_explicit_planner_override():
    request = AskRequest(
        query="How many records are available?",
        id="deploy-id",
        use_dry_plan=False,
        allow_dry_plan_fallback=True,
    )

    assert request.use_dry_plan is False
    assert request.allow_dry_plan_fallback is True


def test_sql_correction_router_defaults_to_planner_validation_without_fallback():
    request = PostRequest(sql="SELECT 1", error="dry run failed")

    assert request.use_dry_plan is True
    assert request.allow_dry_plan_fallback is False


def test_sql_correction_service_defaults_to_planner_validation_without_fallback():
    request = SqlCorrectionService.CorrectionRequest(
        event_id="event-id",
        sql="SELECT 1",
        error="dry run failed",
    )

    assert request.use_dry_plan is True
    assert request.allow_dry_plan_fallback is False
