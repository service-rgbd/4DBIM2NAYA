from pathlib import Path
from dotenv import load_dotenv

load_dotenv(Path(__file__).parent / ".env")

import asyncio  # noqa: E402
import logging  # noqa: E402
import os  # noqa: E402
from fastapi import FastAPI, APIRouter, Request  # noqa: E402
from fastapi.responses import JSONResponse  # noqa: E402
from starlette.middleware.cors import CORSMiddleware  # noqa: E402
from core.db import client, create_indexes  # noqa: E402
from routers import auth, projects, tasks, bim  # noqa: E402
from services.bim_worker import worker_loop  # noqa: E402
from services.seed import seed  # noqa: E402

logging.basicConfig(level=logging.INFO, format='{"t":"%(asctime)s","lvl":"%(levelname)s","logger":"%(name)s","msg":"%(message)s"}')
logger = logging.getLogger("server")

app = FastAPI(title="BIM 4D — API de coordination de chantier", version="1.0.0", docs_url="/api/docs", openapi_url="/api/openapi.json")
api = APIRouter(prefix="/api")
v1 = APIRouter(prefix="/v1")


@api.get("/health")
async def health_check():
    return {"status": "ok"}


for r in (auth.router, projects.router, tasks.router, bim.router):
    v1.include_router(r)
api.include_router(v1)
app.include_router(api)

ALLOWED_ORIGINS = [o.strip() for o in os.environ["FRONTEND_URL"].split(",") if o.strip()]


@app.middleware("http")
async def origin_guard(request: Request, call_next):
    origin = request.headers.get("origin")
    if request.method in ("POST", "PUT", "PATCH", "DELETE") and origin and origin not in ALLOWED_ORIGINS and request.cookies.get("access_token"):
        return JSONResponse(status_code=403, content={"detail": "Origine non autorisée"})
    return await call_next(request)


@app.exception_handler(Exception)
async def unhandled(request: Request, exc: Exception):
    logger.exception("Erreur non gérée sur %s %s", request.method, request.url.path)
    return JSONResponse(status_code=500, content={"detail": "Erreur interne du serveur. L'incident a été journalisé."})


app.add_middleware(CORSMiddleware, allow_credentials=True, allow_origins=ALLOWED_ORIGINS, allow_methods=["*"], allow_headers=["*"])


@app.on_event("startup")
async def startup():
    await create_indexes()
    await seed()
    app.state.worker = asyncio.create_task(worker_loop())


@app.on_event("shutdown")
async def shutdown():
    if getattr(app.state, "worker", None):
        app.state.worker.cancel()
    client.close()
