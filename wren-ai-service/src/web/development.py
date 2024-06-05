from fastapi import APIRouter

router = APIRouter()


@router.get("/dummy")
async def hello():
    return {"message": "Hello World"}
