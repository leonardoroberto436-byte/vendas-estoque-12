import { ApiError } from "@/lib/api";
import type { MovementType, PaymentMethod, Product } from "@/lib/types";

const brl = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
const dateTime = new Intl.DateTimeFormat("pt-BR", {
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});
const shortDate = new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "2-digit" });

export const money = (value: number) => brl.format(value ?? 0);
export const formatDateTime = (iso: string) => dateTime.format(new Date(iso));
export const formatShortDate = (isoDate: string) =>
  shortDate.format(new Date(`${isoDate}T12:00:00`));

export const PAYMENT_LABELS: Record<PaymentMethod, string> = {
  DINHEIRO: "Dinheiro",
  PIX: "PIX",
  CARTAO_DEBITO: "Cartão de Débito",
  CARTAO_CREDITO: "Cartão de Crédito",
};

export const MOVEMENT_LABELS: Record<MovementType, string> = {
  ENTRADA: "Entrada de Estoque",
  VENDA: "Saída por Venda",
  AJUSTE_POSITIVO: "Ajuste Positivo",
  AJUSTE_NEGATIVO: "Ajuste Negativo",
  PERDA: "Perda / Quebra",
};

export type StockStatus = "ESGOTADO" | "BAIXO" | "OK";

export function stockStatus(product: Pick<Product, "current_stock" | "min_stock">): StockStatus {
  if (product.current_stock === 0) return "ESGOTADO";
  if (product.current_stock <= product.min_stock) return "BAIXO";
  return "OK";
}

export const STOCK_STATUS_LABELS: Record<StockStatus, string> = {
  ESGOTADO: "Esgotado",
  BAIXO: "Estoque Baixo",
  OK: "Em Estoque",
};

export const STOCK_STATUS_CLASSES: Record<StockStatus, string> = {
  ESGOTADO: "bg-red-100 text-red-800 border-red-200",
  BAIXO: "bg-amber-100 text-amber-900 border-amber-200",
  OK: "bg-emerald-100 text-emerald-800 border-emerald-200",
};

export function margin(product: Pick<Product, "cost_price" | "sale_price">): number {
  if (!product.sale_price) return 0;
  return ((product.sale_price - product.cost_price) / product.sale_price) * 100;
}

/** Pull the human-readable message out of a FastAPI error body. */
export function errorMessage(error: unknown, fallback = "Não foi possível concluir a operação"): string {
  if (error instanceof ApiError) {
    const body = error.body as { detail?: unknown } | null;
    const detail = body?.detail;
    if (typeof detail === "string") return detail;
    if (Array.isArray(detail) && detail.length > 0) {
      const first = detail[0] as { msg?: string };
      if (first?.msg) return first.msg;
    }
  }
  if (error instanceof Error && error.message) return fallback;
  return fallback;
}
