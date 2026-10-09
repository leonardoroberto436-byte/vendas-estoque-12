// Hand-written mirrors of the Pydantic models in backend/models/*.py.
// Change one, change the other in the same edit.

// ----------------------------------------------------------- organizations
export type Plan = "TESTE" | "INICIAL" | "PROFISSIONAL" | "AVANCADO";
export type SubscriptionStatus = "TESTE" | "ATIVO" | "INADIMPLENTE" | "CANCELADO";
export type OrgStatus = "PENDENTE" | "APROVADA" | "SUSPENSA";

export interface OrgSummary {
  id: string;
  name: string;
  status: OrgStatus;
  plan: Plan;
  plan_label: string;
  subscription_status: SubscriptionStatus;
  trial_ends_at: string | null;
  trial_days_left: number | null;
  due_date: string | null;
  days_to_due: number | null;
}

export interface PlanPrices {
  prices: Record<string, number>;
}

export interface PlanRevenue {
  plan: Plan;
  plan_label: string;
  price: number;
  paying_orgs: number;
  total_orgs: number;
  monthly_revenue: number;
}

export interface PlatformRevenue {
  mrr: number;
  expected_mrr: number;
  overdue_amount: number;
  paying_orgs: number;
  trial_orgs: number;
  by_plan: PlanRevenue[];
}

export interface PlatformLog {
  id: string;
  actor_email: string;
  action: string;
  target: string;
  details: string;
  created_at: string;
}

export interface BackupRecord {
  id: string;
  file: string;
  size_bytes: number;
  status: string;
  error: string;
  created_at: string;
}

export interface OrgBranding {
  trade_name: string;
  cnpj: string;
  phone: string;
  address: string;
  logo: string | null;
}

export interface PlatformOrgView extends OrgSummary {
  owner_name: string;
  owner_email: string;
  created_at: string;
  approved_at: string | null;
  suspended_at: string | null;
  user_count: number;
  product_count: number;
  sales_count: number;
  last_activity_at: string | null;
}

export interface PlatformUserView {
  id: string;
  name: string;
  email: string;
  role: Role;
  is_active: boolean;
  org_id: string | null;
  org_name: string;
  created_at: string;
  last_login_at: string | null;
}

export interface PlatformStats {
  total_orgs: number;
  pending_orgs: number;
  approved_orgs: number;
  suspended_orgs: number;
  total_users: number;
  by_plan: Record<string, number>;
  by_subscription: Record<string, number>;
  recent_orgs: PlatformOrgView[];
}

export interface OrgCreateRequest {
  company_name: string;
  owner_name: string;
  owner_email: string;
  plan: Plan;
  subscription_status: SubscriptionStatus;
  send_email: boolean;
}

export interface OrgUpdateRequest {
  name: string;
  owner_name: string;
  owner_email: string;
}

export interface OrgCredentials {
  organization: PlatformOrgView;
  admin_email: string;
  admin_password: string;
  email_sent: boolean;
  message: string;
}

export interface SignupRequest {
  name: string;
  company_name: string;
  email: string;
  password: string;
}

export interface SignupResponse {
  organization_id: string;
  company_name: string;
  status: OrgStatus;
  message: string;
}

// -------------------------------------------------------------------- users
export type Role = "PLATFORM_OWNER" | "ADMIN" | "OPERADOR";
export type CompanyRole = "ADMIN" | "OPERADOR";

export interface User {
  id: string;
  name: string;
  email: string;
  role: Role;
  org_id: string | null;
  is_active: boolean;
  created_at: string;
  last_login_at: string | null;
}

export interface SessionUser extends User {
  organization: OrgSummary | null;
}

export interface UserCreate {
  name: string;
  email: string;
  password: string;
  role: CompanyRole;
  is_active: boolean;
}

export interface UserUpdate {
  name?: string;
  role?: CompanyRole;
  is_active?: boolean;
}

export interface AccessLog {
  id: string;
  user_id: string | null;
  org_id: string | null;
  user_name: string;
  email: string;
  role: Role | null;
  event:
    | "LOGIN_OK"
    | "LOGIN_FALHOU"
    | "LOGIN_BLOQUEADO"
    | "LOGOUT"
    | "CADASTRO"
    | "RESET_SOLICITADO"
    | "RESET_CONCLUIDO";
  ip: string;
  user_agent: string;
  created_at: string;
}

// ---------------------------------------------------------------- inventory
export type MovementType =
  | "ENTRADA"
  | "VENDA"
  | "DEVOLUCAO"
  | "AJUSTE_POSITIVO"
  | "AJUSTE_NEGATIVO"
  | "PERDA";

export type PaymentMethod = "DINHEIRO" | "PIX" | "CARTAO_DEBITO" | "CARTAO_CREDITO";

export interface Product {
  id: string;
  org_id: string | null;
  name: string;
  sku: string;
  category: string;
  cost_price: number;
  sale_price: number;
  current_stock: number;
  min_stock: number;
  created_at: string;
  updated_at: string;
}

export interface ProductCreate {
  name: string;
  sku: string;
  category: string;
  cost_price: number;
  sale_price: number;
  current_stock: number;
  min_stock: number;
}

export interface ProductUpdate {
  name?: string;
  sku?: string;
  category?: string;
  cost_price?: number;
  sale_price?: number;
  min_stock?: number;
}

export interface SaleItem {
  product_id: string;
  product_name: string;
  sku: string;
  quantity: number;
  unit_price: number;
  unit_cost: number;
  line_total: number;
}

export interface Sale {
  id: string;
  org_id: string | null;
  code: string;
  items: SaleItem[];
  subtotal: number;
  discount: number;
  total: number;
  cost_total: number;
  profit: number;
  payment_method: PaymentMethod;
  notes: string;
  seller_id: string | null;
  seller_name: string;
  returned_total: number;
  created_at: string;
}

export interface SaleCreate {
  items: { product_id: string; quantity: number }[];
  payment_method: PaymentMethod;
  discount: number;
  notes: string;
}

// -------------------------------------------------------------- devoluções
export interface ReturnItem {
  product_id: string;
  product_name: string;
  sku: string;
  quantity: number;
  unit_price: number;
  unit_cost: number;
  line_total: number;
}

export interface SaleReturn {
  id: string;
  org_id: string | null;
  sale_id: string;
  sale_code: string;
  items: ReturnItem[];
  refund_total: number;
  cost_total: number;
  reason: string;
  restocked: boolean;
  operator_id: string | null;
  operator_name: string;
  created_at: string;
}

export interface ReturnCreate {
  sale_id: string;
  items: { product_id: string; quantity: number }[];
  reason: string;
  restock: boolean;
}

export interface ReturnableItem {
  product_id: string;
  product_name: string;
  sku: string;
  sold_quantity: number;
  returned_quantity: number;
  returnable_quantity: number;
  unit_price: number;
}

export interface ReturnableSale {
  sale_id: string;
  sale_code: string;
  created_at: string;
  seller_name: string;
  total: number;
  already_refunded: number;
  items: ReturnableItem[];
}

// ------------------------------------------------------------------- stock
export interface StockMovement {
  id: string;
  org_id: string | null;
  product_id: string;
  product_name: string;
  sku: string;
  type: MovementType;
  quantity: number;
  delta: number;
  stock_after: number;
  reason: string;
  operator_name: string;
  sale_id: string | null;
  created_at: string;
}

export interface StockMovementCreate {
  product_id: string;
  type: MovementType;
  quantity: number;
  reason: string;
}

// --------------------------------------------------------------- dashboard
export interface LowStockItem {
  id: string;
  name: string;
  sku: string;
  category: string;
  current_stock: number;
  min_stock: number;
}

export interface RevenuePoint {
  date: string;
  revenue: number;
  sales_count: number;
}

export interface TopProduct {
  product_id: string;
  name: string;
  quantity: number;
  revenue: number;
}

export interface TopSeller {
  seller_id: string | null;
  name: string;
  sales_count: number;
  revenue: number;
}

export interface DashboardStats {
  today: string;
  today_sales_count: number;
  today_revenue: number;
  today_profit: number;
  low_stock_count: number;
  out_of_stock_count: number;
  inventory_value: number;
  product_count: number;
  period_days: number;
  period_revenue: number;
  period_profit: number;
  period_sales_count: number;
  period_returns_count: number;
  period_refunded: number;
  period_net_revenue: number;
  period_average_ticket: number;
  low_stock_items: LowStockItem[];
  revenue_series: RevenuePoint[];
  top_products: TopProduct[];
  top_sellers: TopSeller[];
}

// ----------------------------------------------------------------- reports
export interface ReportMonth {
  year: number;
  month: number;
  label: string;
}

export interface ReportDayPoint {
  day: number;
  revenue: number;
  profit: number;
  sales_count: number;
}

export interface PaymentBreakdown {
  payment_method: PaymentMethod;
  revenue: number;
  sales_count: number;
  share_percent: number;
}

export interface MonthlyReport {
  year: number;
  month: number;
  label: string;
  generated_at: string;
  sales_count: number;
  items_sold: number;
  revenue: number;
  cost: number;
  profit: number;
  discount_total: number;
  margin_percent: number;
  average_ticket: number;
  best_day: number | null;
  best_day_revenue: number;
  daily: ReportDayPoint[];
  payments: PaymentBreakdown[];
  top_products: TopProduct[];
}
