// Hand-written mirrors of the Pydantic models in backend/models/inventory.py.
// Change one, change the other in the same edit.

export type Role = "ADMIN" | "OPERADOR";

export interface User {
  id: string;
  name: string;
  email: string;
  role: Role;
  is_active: boolean;
  created_at: string;
  last_login_at: string | null;
}

export interface UserCreate {
  name: string;
  email: string;
  password: string;
  role: Role;
  is_active: boolean;
}

export interface UserUpdate {
  name?: string;
  role?: Role;
  is_active?: boolean;
}

export type MovementType =
  | "ENTRADA"
  | "VENDA"
  | "AJUSTE_POSITIVO"
  | "AJUSTE_NEGATIVO"
  | "PERDA";

export type PaymentMethod = "DINHEIRO" | "PIX" | "CARTAO_DEBITO" | "CARTAO_CREDITO";

export interface Product {
  id: string;
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
  items: SaleItem[];
  subtotal: number;
  discount: number;
  total: number;
  cost_total: number;
  profit: number;
  payment_method: PaymentMethod;
  notes: string;
  created_at: string;
}

export interface SaleCreate {
  items: { product_id: string; quantity: number }[];
  payment_method: PaymentMethod;
  discount: number;
  notes: string;
}

export interface StockMovement {
  id: string;
  product_id: string;
  product_name: string;
  sku: string;
  type: MovementType;
  quantity: number;
  delta: number;
  stock_after: number;
  reason: string;
  sale_id: string | null;
  created_at: string;
}

export interface StockMovementCreate {
  product_id: string;
  type: MovementType;
  quantity: number;
  reason: string;
}

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

export interface DashboardStats {
  today: string;
  today_sales_count: number;
  today_revenue: number;
  today_profit: number;
  low_stock_count: number;
  out_of_stock_count: number;
  inventory_value: number;
  product_count: number;
  low_stock_items: LowStockItem[];
  revenue_series: RevenuePoint[];
  top_products: TopProduct[];
}
