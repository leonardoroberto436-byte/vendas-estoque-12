import { NavLink, useLocation } from "react-router-dom";
import {
  AlertTriangle,
  ArrowLeftRight,
  LayoutDashboard,
  Package,
  Receipt,
  ShoppingCart,
  Store,
} from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { apiGet } from "@/lib/api";
import type { DashboardStats } from "@/lib/types";
import { cn } from "@/lib/utils";
import { Toaster } from "@/components/ui/sonner";

const NAV = [
  { to: "/", label: "Visão Geral", icon: LayoutDashboard, testId: "nav-dashboard" },
  { to: "/vender", label: "Vender (Balcão)", icon: ShoppingCart, testId: "nav-sales-pos" },
  { to: "/vendas", label: "Histórico", icon: Receipt, testId: "nav-sales-history" },
  { to: "/produtos", label: "Produtos", icon: Package, testId: "nav-products" },
  { to: "/estoque", label: "Movimentações", icon: ArrowLeftRight, testId: "nav-stock" },
  { to: "/alertas", label: "Alertas", icon: AlertTriangle, testId: "nav-alerts" },
];

export default function AppShell({ children }: { children: React.ReactNode }) {
  const location = useLocation();
  const { data: stats, isError } = useQuery({
    queryKey: ["dashboard-stats"],
    queryFn: () => apiGet<DashboardStats>("/dashboard/stats"),
    refetchOnWindowFocus: false,
  });
  const alertCount = isError ? 0 : (stats?.low_stock_count ?? 0);

  return (
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-30 border-b border-border bg-white/85 backdrop-blur-md">
        <div className="mx-auto flex max-w-[1400px] flex-col gap-3 px-5 py-3 lg:px-8">
          <div className="flex items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <span className="flex size-10 items-center justify-center rounded-xl bg-primary text-primary-foreground shadow-sm">
                <Store className="size-5" />
              </span>
              <div className="leading-tight">
                <p
                  className="text-base font-bold tracking-tight text-slate-900"
                  data-testid="app-title"
                >
                  Estoque &amp; Vendas Pro
                </p>
                <p className="text-xs font-medium text-slate-500">
                  Controle de catálogo, estoque e vendas de balcão
                </p>
              </div>
            </div>
            <NavLink
              to="/vender"
              data-testid="btn-quick-new-sale"
              className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground shadow-sm transition-colors duration-150 ease-out hover:bg-teal-700 active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-500 focus-visible:ring-offset-2"
            >
              <ShoppingCart className="size-4" />
              Nova Venda
            </NavLink>
          </div>

          <nav className="-mx-1 flex items-center gap-1 overflow-x-auto pb-1">
            {NAV.map((item) => {
              const active =
                item.to === "/" ? location.pathname === "/" : location.pathname.startsWith(item.to);
              return (
                <NavLink
                  key={item.to}
                  to={item.to}
                  data-testid={item.testId}
                  className={cn(
                    "inline-flex shrink-0 items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium transition-colors duration-150 ease-out",
                    active
                      ? "bg-slate-900 text-white"
                      : "text-slate-600 hover:bg-slate-100 hover:text-slate-900",
                  )}
                >
                  <item.icon className="size-4" />
                  {item.label}
                  {item.to === "/alertas" && alertCount > 0 && (
                    <span
                      className="ml-0.5 rounded-md bg-amber-200 px-1.5 py-0.5 font-mono text-[11px] font-bold text-amber-900"
                      data-testid="nav-alerts-badge"
                    >
                      {alertCount}
                    </span>
                  )}
                </NavLink>
              );
            })}
          </nav>
        </div>
      </header>

      <main className="mx-auto max-w-[1400px] px-5 py-6 lg:px-8 lg:py-8">{children}</main>
      <Toaster richColors />
    </div>
  );
}
