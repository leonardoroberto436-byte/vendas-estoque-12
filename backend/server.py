import asyncio
from contextlib import asynccontextmanager
from fastapi import FastAPI, APIRouter
from dotenv import load_dotenv
from starlette.middleware.cors import CORSMiddleware
import os
import logging
from pathlib import Path
from pydantic import BaseModel, Field
from typing import List
import uuid
from datetime import datetime


ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / '.env')

# MongoDB connection
from lib.db import client, db, ensure_indexes


# Startup runs before the yield, shutdown after it. Add your own setup/teardown here.
@asynccontextmanager
async def lifespan(app: FastAPI):
    app.state.index_task = asyncio.create_task(ensure_indexes())  # background: a big index build must not block boot
    await ensure_bootstrap_accounts()
    yield
    client.close()


# Create the main app without a prefix
app = FastAPI(lifespan=lifespan)

# Create a router with the /api prefix
api_router = APIRouter(prefix="/api")


# Define Models
class StatusCheck(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    client_name: str
    timestamp: datetime = Field(default_factory=datetime.utcnow)

class StatusCheckCreate(BaseModel):
    client_name: str

# Add your routes to the router instead of directly to app
@api_router.get("/")
async def root():
    return {"message": "Hello World"}

# Feature routers — each exposes its own APIRouter, folded into /api here
from lib.auth import ensure_bootstrap_accounts  # noqa: E402
from routers import (  # noqa: E402
    auth,
    dashboard,
    cron,
    platform,
    settings as settings_router,
    products,
    reports,
    returns,
    sales,
    stock,
    users,
)

# Public: signup / login / forgot-password handle their own checks
api_router.include_router(auth.router)

# Tenant-scoped: each router declares require_org (or require(...)) per route,
# so the org always comes from the session, never from the request.
api_router.include_router(products.router)
api_router.include_router(sales.router)
api_router.include_router(returns.router)
api_router.include_router(stock.router)
api_router.include_router(dashboard.router)
api_router.include_router(reports.router)

# Company admin only (users:manage) — scoped to their own organization
api_router.include_router(users.router)

# SaaS owner only (platform:manage) — the single cross-organization surface
api_router.include_router(settings_router.router)
api_router.include_router(platform.router)

# Platform cron webhook (shared-secret auth, no session)
api_router.include_router(cron.router)

# Include the router in the main app
app.include_router(api_router)

app.add_middleware(
    CORSMiddleware,
    allow_credentials=True,
    # Explicit origins only: reflecting any origin together with credentials
    # would let a third-party site read the API with the user's cookie.
    allow_origins=[o.strip() for o in os.environ.get('CORS_ORIGINS', '').split(',') if o.strip()],
    allow_methods=["*"],
    allow_headers=["*"],
)

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)
