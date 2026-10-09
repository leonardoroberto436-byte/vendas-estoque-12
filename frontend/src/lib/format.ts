import { ApiError } from "@/lib/api";
import type {
  MovementType,
  OrgBranding,
  OrgStatus,
  PaymentMethod,
  Plan,
  Product,
  Role,
  Sale,
  SubscriptionStatus,
} from "@/lib/types";

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
  DEVOLUCAO: "Devolução (retorno)",
  AJUSTE_POSITIVO: "Ajuste Positivo",
  AJUSTE_NEGATIVO: "Ajuste Negativo",
  PERDA: "Perda / Quebra",
};

export const ROLE_LABELS: Record<Role, string> = {
  PLATFORM_OWNER: "Dono da Plataforma",
  ADMIN: "Administrador",
  OPERADOR: "Operador",
};

export const ORG_STATUS_LABELS: Record<OrgStatus, string> = {
  PENDENTE: "Aguardando liberação",
  APROVADA: "Liberada",
  SUSPENSA: "Suspensa",
};

export const ORG_STATUS_CLASSES: Record<OrgStatus, string> = {
  PENDENTE: "bg-amber-100 text-amber-900 border-amber-200",
  APROVADA: "bg-emerald-100 text-emerald-800 border-emerald-200",
  SUSPENSA: "bg-red-100 text-red-800 border-red-200",
};

export const PLAN_LABELS: Record<Plan, string> = {
  TESTE: "Período de teste",
  INICIAL: "Inicial",
  PROFISSIONAL: "Profissional",
  AVANCADO: "Avançado",
};

export const SUBSCRIPTION_LABELS: Record<SubscriptionStatus, string> = {
  TESTE: "Em teste",
  ATIVO: "Ativo",
  INADIMPLENTE: "Inadimplente",
  CANCELADO: "Cancelado",
};

export const SUBSCRIPTION_CLASSES: Record<SubscriptionStatus, string> = {
  TESTE: "bg-sky-100 text-sky-800 border-sky-200",
  ATIVO: "bg-emerald-100 text-emerald-800 border-emerald-200",
  INADIMPLENTE: "bg-amber-100 text-amber-900 border-amber-200",
  CANCELADO: "bg-slate-200 text-slate-700 border-slate-300",
};

/** Plain-text receipt used for printing and for the WhatsApp message. */
export function receiptText(sale: Sale, company: string, branding?: OrgBranding | null): string {
  const header = [
    `*${branding?.trade_name?.trim() || company}*`,
    branding?.cnpj?.trim() ? `CNPJ: ${branding.cnpj}` : "",
    branding?.address?.trim() ?? "",
    branding?.phone?.trim() ? `Tel: ${branding.phone}` : "",
  ].filter(Boolean);
  const lines = [
    ...header,
    `Cupom ${sale.code}`,
    formatDateTime(sale.created_at),
    `Vendedor: ${sale.seller_name || "-"}`,
    "",
    ...sale.items.map(
      (item) =>
        `${item.quantity}x ${item.product_name} - ${money(item.line_total)}`,
    ),
    "",
    `Subtotal: ${money(sale.subtotal)}`,
  ];
  if (sale.discount > 0) lines.push(`Desconto: -${money(sale.discount)}`);
  lines.push(`TOTAL: ${money(sale.total)}`);
  lines.push(`Pagamento: ${PAYMENT_LABELS[sale.payment_method]}`);
  lines.push("", "Obrigado pela preferencia!");
  return lines.join("\n");
}

/** wa.me deep link. Phone is optional — without it WhatsApp asks who to send to. */
export function whatsappLink(text: string, phone?: string): string {
  const digits = (phone ?? "").replace(/\D/g, "");
  const target = digits ? (digits.length > 11 ? digits : `55${digits}`) : "";
  return `https://wa.me/${target}?text=${encodeURIComponent(text)}`;
}

/** Print only the receipt area, leaving the rest of the app out of the page. */
export function printReceipt(): void {
  document.body.classList.add("printing-receipt");
  const cleanup = () => {
    document.body.classList.remove("printing-receipt");
    window.removeEventListener("afterprint", cleanup);
  };
  window.addEventListener("afterprint", cleanup);
  window.print();
  window.setTimeout(cleanup, 1500);
}

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
