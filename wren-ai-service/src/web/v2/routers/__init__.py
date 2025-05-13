from fastapi import APIRouter

from src.web.v2.routers import conversation

router = APIRouter()
router.include_router(conversation.router)
