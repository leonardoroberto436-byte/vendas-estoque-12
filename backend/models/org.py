"""Organization (tenant) + subscription models.

One organization == one customer company == one isolated workspace. Mirrors
frontend/src/lib/types.ts.
"""

import uuid
from datetime import datetime, timezone
from typing import List, Literal, Optional

from pydantic import BaseModel, EmailStr, Field

Plan = Literal["TESTE", "INICIAL", "PROFISSIONAL", "AVANCADO"]
SubscriptionStatus = Literal["TESTE", "ATIVO", "INADIMPLENTE", "CANCELADO"]
OrgStatus = Literal["PENDENTE", "APROVADA", "SUSPENSA"]

TRIAL_DAYS = 14

PLAN_LABELS: dict[str, str] = {
    "TESTE": "Período de teste",
    "INICIAL": "Inicial",
    "PROFISSIONAL": "Profissional",
    "AVANCADO": "Avançado",
}

# Monthly price per plan (BRL). Editable by the platform owner at runtime;
# this dict is only the fallback used before the first edit.
DEFAULT_PLAN_PRICES: dict[str, float] = {
    "TESTE": 0.0,
    "INICIAL": 49.90,
    "PROFISSIONAL": 79.90,
    "AVANCADO": 129.90,
}

# Days before the due date that trigger a reminder e-mail (0 = on the day).
REMINDER_DAYS = (7, 3, 1, 0)


def _uid() -> str:
    return str(uuid.uuid4())


def _now() -> datetime:
    return datetime.now(timezone.utc)


class Organization(BaseModel):
    id: str = Field(default_factory=_uid)
    name: str
    owner_name: str
    owner_email: str
    status: OrgStatus = "PENDENTE"
    plan: Plan = "TESTE"
    subscription_status: SubscriptionStatus = "TESTE"
    trial_ends_at: Optional[datetime] = None
    due_date: Optional[datetime] = None
    reminders_sent: List[str] = Field(default_factory=list)
    created_at: datetime = Field(default_factory=_now)
    approved_at: Optional[datetime] = None
    suspended_at: Optional[datetime] = None
    notes: str = ""


class SignupRequest(BaseModel):
    """Public self-service signup: creates the org (PENDENTE) + its first admin."""

    name: str = Field(min_length=2, max_length=80)
    company_name: str = Field(min_length=2, max_length=120)
    email: EmailStr
    password: str = Field(min_length=8, max_length=128)


class SignupResponse(BaseModel):
    organization_id: str
    company_name: str
    status: OrgStatus
    message: str


class OrgSummary(BaseModel):
    """What a signed-in user may learn about their own workspace."""

    id: str
    name: str
    status: OrgStatus
    plan: Plan
    plan_label: str
    subscription_status: SubscriptionStatus
    trial_ends_at: Optional[datetime] = None
    trial_days_left: Optional[int] = None
    due_date: Optional[datetime] = None
    days_to_due: Optional[int] = None


class PlatformOrgView(OrgSummary):
    """Platform-owner view — adds owner contact and counters."""

    owner_name: str
    owner_email: str
    created_at: datetime
    approved_at: Optional[datetime] = None
    suspended_at: Optional[datetime] = None
    user_count: int
    product_count: int
    sales_count: int
    last_activity_at: Optional[datetime] = None


class OrgStatusUpdate(BaseModel):
    status: OrgStatus


class OrgCreateRequest(BaseModel):
    """Platform owner creates a customer company + its first ADMIN in one step."""

    company_name: str = Field(min_length=2, max_length=120)
    owner_name: str = Field(min_length=2, max_length=80)
    owner_email: EmailStr
    plan: Plan = "TESTE"
    subscription_status: SubscriptionStatus = "TESTE"
    send_email: bool = True


class OrgUpdateRequest(BaseModel):
    """Edit company identification. The admin login e-mail follows owner_email."""

    name: str = Field(min_length=2, max_length=120)
    owner_name: str = Field(min_length=2, max_length=80)
    owner_email: EmailStr


class OrgCredentials(BaseModel):
    """Returned once, right after creating a company or resetting its admin."""

    organization: PlatformOrgView
    admin_email: str
    admin_password: str
    email_sent: bool
    message: str


class OrgPlanUpdate(BaseModel):
    plan: Plan
    subscription_status: SubscriptionStatus
    # ISO date (YYYY-MM-DD) or null to clear. Set manually by the platform owner.
    due_date: Optional[str] = None


class PlanPrices(BaseModel):
    """Monthly price per plan, in BRL."""

    prices: dict[str, float]


class PlanRevenue(BaseModel):
    plan: Plan
    plan_label: str
    price: float
    paying_orgs: int
    total_orgs: int
    monthly_revenue: float


class PlatformRevenue(BaseModel):
    """Recurring revenue snapshot. Counts only companies whose access is live
    and whose subscription is being charged (ATIVO or INADIMPLENTE)."""

    mrr: float
    expected_mrr: float
    overdue_amount: float
    paying_orgs: int
    trial_orgs: int
    by_plan: List[PlanRevenue]


class PlatformUserView(BaseModel):
    id: str
    name: str
    email: str
    role: str
    is_active: bool
    org_id: Optional[str] = None
    org_name: str = ""
    created_at: datetime
    last_login_at: Optional[datetime] = None


class PlatformStats(BaseModel):
    total_orgs: int
    pending_orgs: int
    approved_orgs: int
    suspended_orgs: int
    total_users: int
    by_plan: dict[str, int]
    by_subscription: dict[str, int]
    recent_orgs: List[PlatformOrgView]


# ------------------------------------------------------------ password recovery
class ForgotPasswordRequest(BaseModel):
    email: EmailStr


class ResetPasswordRequest(BaseModel):
    token: str = Field(min_length=10, max_length=200)
    password: str = Field(min_length=8, max_length=128)
