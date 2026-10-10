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

# Teste grátis: curto de propósito — o cliente experimenta e já escolhe o plano.
TRIAL_DAYS = 2

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
    "INICIAL": 79.00,
    "PROFISSIONAL": 129.00,
    "AVANCADO": 199.00,
}

# Plans a company can subscribe to (TESTE is only the free trial).
PAID_PLANS = ("INICIAL", "PROFISSIONAL", "AVANCADO")

# What each plan allows. None = unlimited. Editable by the platform owner at
# runtime (platform_settings "limits"); this dict is the fallback.
# During the free trial the company gets the Profissional package.
DEFAULT_PLAN_LIMITS: dict[str, dict] = {
    "TESTE": {"users": 5, "products": 3000, "history_months": 12, "full_report": True, "branding": True},
    "INICIAL": {"users": 2, "products": 500, "history_months": 3, "full_report": False, "branding": False},
    "PROFISSIONAL": {"users": 5, "products": 3000, "history_months": 12, "full_report": True, "branding": True},
    "AVANCADO": {"users": None, "products": None, "history_months": None, "full_report": True, "branding": True},
}

# Founder coupon: 50% off for life, first 10 companies only.
FOUNDER_COUPON = "FUNDADOR"
FOUNDER_DISCOUNT = 0.5
FOUNDER_SLOTS = 10

# Days a failed payment is tolerated before the company is suspended.
PAYMENT_GRACE_DAYS = 5

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
    # aceite dos Termos de Uso e da Política de Privacidade (obrigatório)
    accept_terms: bool = False


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
    # teste grátis vencido: a empresa fica bloqueada até o dono escolher um plano
    trial_expired: bool = False
    # TESTE_ENCERRADO | PAGAMENTO | CANCELADO — só "Minha assinatura" funciona
    billing_block: str = ""
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
    extra_users: int = 0
    extra_products: int = 0
    # Mercado Pago: estado da assinatura no MP e se o último pagamento falhou
    mp_status: str = ""
    payment_failed_at: Optional[datetime] = None
    suspended_reason: str = ""


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
    # dinheiro que de fato entrou pelo Mercado Pago nos últimos 30 dias
    received_last_30d: float = 0.0


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


class PlatformLog(BaseModel):
    """Trilha de auditoria das ações do proprietário da plataforma."""

    id: str
    actor_email: str
    action: str
    target: str = ""
    details: str = ""
    created_at: datetime


class BackupRecord(BaseModel):
    id: str
    file: str
    size_bytes: int
    status: str
    error: str = ""
    # cópia fora do servidor: ENVIADO, FALHOU, NAO_CONFIGURADO (ou vazio em backups antigos)
    offsite: str = ""
    created_at: datetime


class BackupSettings(BaseModel):
    offsite_configured: bool
    keep: int


class RestoreOrgRequest(BaseModel):
    org_id: str
    # False = só mostra o que seria restaurado; True = grava (com backup de segurança antes)
    confirm: bool = False


class RestoreResult(BaseModel):
    org_id: str
    org_name: str
    file: str
    counts: dict[str, int]
    applied: bool
    safety_backup: str = ""
    message: str


class OrgDeleteRequest(BaseModel):
    # o nome da empresa digitado de novo — evita excluir a empresa errada sem querer
    confirm_name: str


class OrgBulkDeleteRequest(BaseModel):
    ids: List[str] = Field(min_length=1, max_length=500)
    # precisa ser exatamente "EXCLUIR"
    confirm: str


class DeleteResult(BaseModel):
    deleted_orgs: int
    deleted_users: int
    deleted_records: int
    safety_backup: str
    message: str



# ------------------------------------------------------------ limites por plano
class PlanLimit(BaseModel):
    users: Optional[int] = Field(default=None, ge=0)
    products: Optional[int] = Field(default=None, ge=0)
    history_months: Optional[int] = Field(default=None, ge=1)
    full_report: bool = True
    branding: bool = True


class PlanLimits(BaseModel):
    limits: dict[str, PlanLimit]


class OrgLimitOverride(BaseModel):
    """Exceção por empresa: unidades a mais além do plano."""

    extra_users: int = Field(default=0, ge=0, le=1000)
    extra_products: int = Field(default=0, ge=0, le=1_000_000)


class UsageItem(BaseModel):
    used: int
    limit: Optional[int] = None


# ------------------------------------------------------------ assinatura
class BillingInfo(BaseModel):
    """O que a loja vê em "Minha assinatura"."""

    plan: Plan
    plan_label: str
    subscription_status: SubscriptionStatus
    status: OrgStatus
    trial_ends_at: Optional[datetime] = None
    trial_expired: bool = False
    due_date: Optional[datetime] = None
    price: float = 0.0
    coupon: str = ""
    mp_status: str = ""
    payment_failed_at: Optional[datetime] = None
    suspend_on: Optional[datetime] = None
    cancel_at: Optional[datetime] = None
    plan_next: str = ""
    billing_block: str = ""
    billing_enabled: bool = False
    founder_slots_left: int = 0
    prices: dict[str, float]
    limits: dict[str, PlanLimit]
    usage: dict[str, UsageItem]


class SubscribeRequest(BaseModel):
    plan: Literal["INICIAL", "PROFISSIONAL", "AVANCADO"]
    coupon: str = Field(default="", max_length=30)
    # e-mail da conta Mercado Pago de quem vai pagar (padrão: o e-mail do admin)
    payer_email: Optional[EmailStr] = None


class SubscribeResponse(BaseModel):
    checkout_url: str
    message: str


class ChangePlanRequest(BaseModel):
    plan: Literal["INICIAL", "PROFISSIONAL", "AVANCADO"]
