import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Ban,
  Building2,
  CheckCircle2,
  Clock,
  Copy,
  KeyRound,
  LogOut,
  Pencil,
  Plus,
  RotateCcw,
  Save,
  Send,
  TrendingUp,
  ShieldCheck,
  Users,
} from "lucide-react";
import { toast } from "sonner";
import { apiGet, apiPost, apiPut } from "@/lib/api";
import type {
  OrgCredentials,
  PlanPrices,
  PlatformRevenue,
  Plan,
  PlatformOrgView,
  PlatformStats,
  PlatformUserView,
  SubscriptionStatus,
} from "@/lib/types";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  ORG_STATUS_CLASSES,
  ORG_STATUS_LABELS,
  PLAN_LABELS,
  ROLE_LABELS,
  SUBSCRIPTION_CLASSES,
  SUBSCRIPTION_LABELS,
  errorMessage,
  formatDateTime,
  money,
} from "@/lib/format";
import { endSession } from "@/lib/session";
import { useCurrentUser } from "@/lib/useCurrentUser";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Toaster } from "@/components/ui/sonner";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

const isoDate = (value: string | null) => (value ? value.slice(0, 10) : null);

const PLANS: Plan[] = ["TESTE", "INICIAL", "PROFISSIONAL", "AVANCADO"];
const SUBSCRIPTIONS: SubscriptionStatus[] = ["TESTE", "ATIVO", "INADIMPLENTE", "CANCELADO"];

const EMPTY_FORM = {
  company_name: "",
  owner_name: "",
  owner_email: "",
  plan: "TESTE" as Plan,
  subscription_status: "TESTE" as SubscriptionStatus,
  send_email: true,
};

export default function Platform() {
  const queryClient = useQueryClient();
  const { user } = useCurrentUser();
  const [createOpen, setCreateOpen] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [editing, setEditing] = useState<PlatformOrgView | null>(null);
  const [editForm, setEditForm] = useState({ name: "", owner_name: "", owner_email: "" });
  const [credentials, setCredentials] = useState<OrgCredentials | null>(null);
  const [priceDraft, setPriceDraft] = useState<Record<string, string> | null>(null);

  const { data: stats } = useQuery({
    queryKey: ["platform-stats"],
    queryFn: () => apiGet<PlatformStats>("/platform/stats"),
    refetchOnWindowFocus: false,
  });
  const { data: orgData, isError: orgError } = useQuery({
    queryKey: ["platform-orgs"],
    queryFn: () => apiGet<PlatformOrgView[]>("/platform/organizations"),
    refetchOnWindowFocus: false,
  });
  const { data: revenue } = useQuery({
    queryKey: ["platform-revenue"],
    queryFn: () => apiGet<PlatformRevenue>("/platform/revenue"),
    refetchOnWindowFocus: false,
  });
  const { data: prices } = useQuery({
    queryKey: ["platform-plan-prices"],
    queryFn: () => apiGet<PlanPrices>("/platform/plan-prices"),
    refetchOnWindowFocus: false,
  });
  const { data: userData } = useQuery({
    queryKey: ["platform-users"],
    queryFn: () => apiGet<PlatformUserView[]>("/platform/users"),
    refetchOnWindowFocus: false,
  });

  const orgs = orgError ? [] : (orgData ?? []);
  const users = userData ?? [];

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ["platform-stats"] });
    void queryClient.invalidateQueries({ queryKey: ["platform-orgs"] });
    void queryClient.invalidateQueries({ queryKey: ["platform-users"] });
    void queryClient.invalidateQueries({ queryKey: ["platform-revenue"] });
  };

  const createOrg = useMutation({
    mutationFn: () =>
      apiPost<OrgCredentials>("/platform/organizations", {
        company_name: form.company_name.trim(),
        owner_name: form.owner_name.trim(),
        owner_email: form.owner_email.trim(),
        plan: form.plan,
        subscription_status: form.subscription_status,
        send_email: form.send_email,
      }),
    onSuccess: (result) => {
      setCreateOpen(false);
      setForm(EMPTY_FORM);
      setCredentials(result);
      toast.success(`${result.organization.name} criada e liberada`);
      refresh();
    },
    onError: (error) => toast.error(errorMessage(error, "Não foi possível criar a empresa")),
  });

  const updateOrg = useMutation({
    mutationFn: (payload: { id: string; name: string; owner_name: string; owner_email: string }) =>
      apiPut<PlatformOrgView>(`/platform/organizations/${payload.id}`, {
        name: payload.name.trim(),
        owner_name: payload.owner_name.trim(),
        owner_email: payload.owner_email.trim(),
      }),
    onSuccess: (org) => {
      setEditing(null);
      toast.success(`${org.name} atualizada`);
      refresh();
    },
    onError: (error) => toast.error(errorMessage(error, "Não foi possível salvar os dados")),
  });

  const resetAdmin = useMutation({
    mutationFn: (id: string) =>
      apiPost<OrgCredentials>(`/platform/organizations/${id}/admin-password`),
    onSuccess: (result) => {
      setCredentials(result);
      toast.success("Nova senha gerada");
      refresh();
    },
    onError: (error) => toast.error(errorMessage(error, "Não foi possível redefinir o acesso")),
  });

  const savePrices = useMutation({
    mutationFn: (draft: Record<string, string>) =>
      apiPut<PlanPrices>("/platform/plan-prices", {
        prices: Object.fromEntries(
          Object.entries(draft).map(([plan, value]) => [
            plan,
            Number(value.replace(",", ".")) || 0,
          ]),
        ),
      }),
    onSuccess: () => {
      setPriceDraft(null);
      toast.success("Preços dos planos atualizados");
      void queryClient.invalidateQueries({ queryKey: ["platform-plan-prices"] });
      void queryClient.invalidateQueries({ queryKey: ["platform-revenue"] });
    },
    onError: (error) => toast.error(errorMessage(error, "Não foi possível salvar os preços")),
  });

  const sendReminders = useMutation({
    mutationFn: () =>
      apiPost<{ sent: number; skipped: number; checked: number }>("/platform/run-due-reminders"),
    onSuccess: (result) =>
      toast.success(
        `${result.sent} aviso(s) enviado(s) · ${result.skipped} já avisado(s) · ${result.checked} empresa(s) verificada(s)`,
      ),
    onError: (error) => toast.error(errorMessage(error, "Não foi possível enviar os avisos")),
  });

  const setStatus = useMutation({
    mutationFn: ({ id, status }: { id: string; status: string }) =>
      apiPut<PlatformOrgView>(`/platform/organizations/${id}/status`, { status }),
    onSuccess: (org) => {
      toast.success(`${org.name}: ${ORG_STATUS_LABELS[org.status]}`);
      refresh();
    },
    onError: (error) => toast.error(errorMessage(error, "Não foi possível alterar o status")),
  });

  const setPlan = useMutation({
    mutationFn: ({
      id,
      plan,
      subscription_status,
      due_date,
    }: {
      id: string;
      plan: Plan;
      subscription_status: SubscriptionStatus;
      due_date: string | null;
    }) =>
      apiPut<PlatformOrgView>(`/platform/organizations/${id}/plan`, {
        plan,
        subscription_status,
        due_date,
      }),
    onSuccess: (org) => {
      toast.success(`${org.name}: ${PLAN_LABELS[org.plan]} / ${SUBSCRIPTION_LABELS[org.subscription_status]}`);
      refresh();
    },
    onError: (error) => toast.error(errorMessage(error, "Não foi possível alterar o plano")),
  });

  const kpis = [
    { label: "Empresas", value: stats?.total_orgs ?? 0, icon: Building2, testId: "platform-kpi-total-orgs" },
    { label: "Aguardando liberação", value: stats?.pending_orgs ?? 0, icon: Clock, testId: "platform-kpi-pending-orgs" },
    { label: "Liberadas", value: stats?.approved_orgs ?? 0, icon: CheckCircle2, testId: "platform-kpi-approved-orgs" },
    { label: "Usuários", value: stats?.total_users ?? 0, icon: Users, testId: "platform-kpi-total-users" },
  ];

  return (
    <div className="min-h-screen bg-slate-950">
      <header className="border-b border-white/10 bg-slate-900/80 backdrop-blur-md">
        <div className="mx-auto flex max-w-[1400px] items-center justify-between gap-4 px-5 py-4 lg:px-8">
          <div className="flex items-center gap-3">
            <span className="flex size-10 items-center justify-center rounded-xl bg-teal-500 text-slate-950">
              <ShieldCheck className="size-5" />
            </span>
            <div className="leading-tight">
              <p className="text-base font-bold tracking-tight text-white" data-testid="platform-title">
                Painel da Plataforma
              </p>
              <p className="text-xs font-medium text-slate-400">
                Área exclusiva do proprietário do SaaS
              </p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            {user && (
              <div className="hidden text-right sm:block" data-testid="platform-current-user">
                <p className="text-sm font-semibold leading-tight text-white">{user.name}</p>
                <p className="text-[11px] uppercase tracking-wider text-teal-400">
                  {ROLE_LABELS[user.role]}
                </p>
              </div>
            )}
            <Button
              variant="outline"
              size="icon"
              aria-label="Sair da conta"
              data-testid="platform-logout-button"
              className="border-white/20 bg-transparent text-white hover:bg-white/10"
              onClick={() => void endSession()}
            >
              <LogOut className="size-4" />
            </Button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-[1400px] px-5 py-8 lg:px-8">
        <div className="mb-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
          {kpis.map((kpi) => (
            <Card key={kpi.testId} className="animate-rise-in border-white/10 bg-slate-900 shadow-none">
              <CardContent className="flex items-center justify-between gap-3 p-5">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wider text-slate-400">
                    {kpi.label}
                  </p>
                  <p
                    className="mt-2 font-mono text-2xl font-semibold tabular-nums text-white"
                    data-testid={kpi.testId}
                  >
                    {kpi.value}
                  </p>
                </div>
                <kpi.icon className="size-5 text-teal-400" />
              </CardContent>
            </Card>
          ))}
        </div>

        <Card className="mb-6 border-white/10 bg-slate-900 shadow-none">
          <CardHeader className="flex flex-row items-center justify-between gap-4">
            <CardTitle className="flex items-center gap-2 text-base font-bold tracking-tight text-white">
              <TrendingUp className="size-4 text-teal-400" />
              Receita da plataforma
            </CardTitle>
            <div className="flex gap-2">
              <Button
                size="sm"
                variant="outline"
                className="border-white/20 bg-transparent text-white hover:bg-white/10"
                data-testid="platform-send-reminders-button"
                disabled={sendReminders.isPending}
                onClick={() => sendReminders.mutate()}
              >
                <Send className="size-4" />
                Enviar avisos de vencimento
              </Button>
              {priceDraft ? (
                <Button
                  size="sm"
                  data-testid="platform-save-prices-button"
                  disabled={savePrices.isPending}
                  onClick={() => savePrices.mutate(priceDraft)}
                >
                  <Save className="size-4" />
                  Salvar preços
                </Button>
              ) : (
                <Button
                  size="sm"
                  variant="outline"
                  className="border-white/20 bg-transparent text-white hover:bg-white/10"
                  data-testid="platform-edit-prices-button"
                  onClick={() =>
                    setPriceDraft(
                      Object.fromEntries(
                        PLANS.map((plan) => [
                          plan,
                          String(prices?.prices?.[plan] ?? 0),
                        ]),
                      ),
                    )
                  }
                >
                  <Pencil className="size-4" />
                  Editar preços
                </Button>
              )}
            </div>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
              <div>
                <p className="text-xs font-semibold uppercase tracking-wider text-slate-400">
                  Receita recorrente (MRR)
                </p>
                <p
                  className="mt-1 font-mono text-2xl font-semibold tabular-nums text-teal-400"
                  data-testid="platform-mrr"
                >
                  {money(revenue?.mrr ?? 0)}
                </p>
                <p className="text-[11px] text-slate-500">só assinaturas ativas</p>
              </div>
              <div>
                <p className="text-xs font-semibold uppercase tracking-wider text-slate-400">
                  Em atraso
                </p>
                <p
                  className="mt-1 font-mono text-2xl font-semibold tabular-nums text-amber-400"
                  data-testid="platform-overdue"
                >
                  {money(revenue?.overdue_amount ?? 0)}
                </p>
                <p className="text-[11px] text-slate-500">inadimplentes</p>
              </div>
              <div>
                <p className="text-xs font-semibold uppercase tracking-wider text-slate-400">
                  Potencial total
                </p>
                <p
                  className="mt-1 font-mono text-2xl font-semibold tabular-nums text-white"
                  data-testid="platform-expected-mrr"
                >
                  {money(revenue?.expected_mrr ?? 0)}
                </p>
                <p className="text-[11px] text-slate-500">ativos + inadimplentes</p>
              </div>
              <div>
                <p className="text-xs font-semibold uppercase tracking-wider text-slate-400">
                  Pagantes / em teste
                </p>
                <p
                  className="mt-1 font-mono text-2xl font-semibold tabular-nums text-white"
                  data-testid="platform-paying-orgs"
                >
                  {revenue?.paying_orgs ?? 0} / {revenue?.trial_orgs ?? 0}
                </p>
                <p className="text-[11px] text-slate-500">empresas</p>
              </div>
            </div>

            <div className="mt-6 overflow-x-auto">
              <Table data-testid="platform-revenue-table">
                <TableHeader>
                  <TableRow className="border-white/10 hover:bg-transparent">
                    <TableHead className="text-slate-400">Plano</TableHead>
                    <TableHead className="text-slate-400">Preço / mês</TableHead>
                    <TableHead className="text-right text-slate-400">Empresas</TableHead>
                    <TableHead className="text-right text-slate-400">Pagantes</TableHead>
                    <TableHead className="text-right text-slate-400">Receita / mês</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {(revenue?.by_plan ?? []).map((row) => (
                    <TableRow
                      key={row.plan}
                      className="border-white/10 hover:bg-white/5"
                      data-testid={`platform-revenue-row-${row.plan}`}
                    >
                      <TableCell className="font-semibold text-white">{row.plan_label}</TableCell>
                      <TableCell>
                        {priceDraft ? (
                          <Input
                            inputMode="decimal"
                            className="w-28 border-white/20 bg-slate-800 text-white"
                            data-testid={`platform-price-input-${row.plan}`}
                            value={priceDraft[row.plan] ?? ""}
                            onChange={(event) =>
                              setPriceDraft({ ...priceDraft, [row.plan]: event.target.value })
                            }
                          />
                        ) : (
                          <span className="font-mono tabular-nums text-slate-200">
                            {money(row.price)}
                          </span>
                        )}
                      </TableCell>
                      <TableCell className="text-right font-mono tabular-nums text-slate-300">
                        {row.total_orgs}
                      </TableCell>
                      <TableCell className="text-right font-mono tabular-nums text-slate-300">
                        {row.paying_orgs}
                      </TableCell>
                      <TableCell
                        className="text-right font-mono font-semibold tabular-nums text-white"
                        data-testid={`platform-revenue-value-${row.plan}`}
                      >
                        {money(row.monthly_revenue)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
            <p className="mt-4 text-xs text-slate-500">
              Avisos de vencimento vão automaticamente para o e-mail do responsável 7, 3 e 1 dia
              antes e no dia do vencimento. Defina a data na coluna “Vencimento” abaixo.
            </p>
          </CardContent>
        </Card>

        <Card className="border-white/10 bg-slate-900 shadow-none">
          <CardHeader className="flex flex-row items-center justify-between gap-4">
            <CardTitle className="text-base font-bold tracking-tight text-white">
              Empresas cadastradas
            </CardTitle>
            <Button
              size="sm"
              data-testid="platform-new-org-button"
              onClick={() => {
                setForm(EMPTY_FORM);
                setCreateOpen(true);
              }}
            >
              <Plus className="size-4" />
              Nova Empresa
            </Button>
          </CardHeader>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <Table data-testid="platform-orgs-table">
                <TableHeader>
                  <TableRow className="border-white/10 hover:bg-transparent">
                    <TableHead className="text-slate-400">Empresa</TableHead>
                    <TableHead className="text-slate-400">Situação</TableHead>
                    <TableHead className="text-slate-400">Plano</TableHead>
                    <TableHead className="text-slate-400">Assinatura</TableHead>
                    <TableHead className="text-slate-400">Vencimento</TableHead>
                    <TableHead className="text-slate-400">Cadastro</TableHead>
                    <TableHead className="text-right text-slate-400">Uso</TableHead>
                    <TableHead className="text-right text-slate-400">Ações</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {orgs.map((org) => (
                    <TableRow
                      key={org.id}
                      className="border-white/10 hover:bg-white/5"
                      data-testid={`platform-org-row-${org.id}`}
                    >
                      <TableCell>
                        <p className="font-semibold text-white">{org.name}</p>
                        <p className="text-xs text-slate-400">
                          {org.owner_name} · {org.owner_email}
                        </p>
                      </TableCell>
                      <TableCell>
                        <span
                          className={`inline-flex items-center rounded-md border px-2 py-1 text-xs font-medium ${ORG_STATUS_CLASSES[org.status]}`}
                          data-testid={`platform-org-status-${org.id}`}
                        >
                          {ORG_STATUS_LABELS[org.status]}
                        </span>
                      </TableCell>
                      <TableCell>
                        <Select
                          value={org.plan}
                          onValueChange={(value: string) =>
                            setPlan.mutate({
                              id: org.id,
                              plan: value as Plan,
                              subscription_status: org.subscription_status,
                              due_date: isoDate(org.due_date),
                            })
                          }
                        >
                          <SelectTrigger
                            size="sm"
                            className="w-40 border-white/20 bg-slate-800 text-white"
                            data-testid={`platform-org-plan-select-${org.id}`}
                          >
                            <SelectValue>{(value) => PLAN_LABELS[value as Plan]}</SelectValue>
                          </SelectTrigger>
                          <SelectContent>
                            {PLANS.map((plan) => (
                              <SelectItem key={plan} value={plan}>
                                {PLAN_LABELS[plan]}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        {org.trial_days_left !== null && org.plan === "TESTE" && (
                          <p className="mt-1 text-[11px] text-slate-400">
                            {org.trial_days_left} dias de teste restantes
                          </p>
                        )}
                      </TableCell>
                      <TableCell>
                        <Select
                          value={org.subscription_status}
                          onValueChange={(value: string) =>
                            setPlan.mutate({
                              id: org.id,
                              plan: org.plan,
                              subscription_status: value as SubscriptionStatus,
                              due_date: isoDate(org.due_date),
                            })
                          }
                        >
                          <SelectTrigger
                            size="sm"
                            className={`w-36 border ${SUBSCRIPTION_CLASSES[org.subscription_status]}`}
                            data-testid={`platform-org-subscription-select-${org.id}`}
                          >
                            <SelectValue>
                              {(value) => SUBSCRIPTION_LABELS[value as SubscriptionStatus]}
                            </SelectValue>
                          </SelectTrigger>
                          <SelectContent>
                            {SUBSCRIPTIONS.map((status) => (
                              <SelectItem key={status} value={status}>
                                {SUBSCRIPTION_LABELS[status]}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </TableCell>
                      <TableCell>
                        <Input
                          type="date"
                          className="w-[150px] border-white/20 bg-slate-800 text-white"
                          data-testid={`platform-org-due-date-input-${org.id}`}
                          defaultValue={isoDate(org.due_date) ?? ""}
                          onChange={(event) =>
                            setPlan.mutate({
                              id: org.id,
                              plan: org.plan,
                              subscription_status: org.subscription_status,
                              due_date: event.target.value || null,
                            })
                          }
                        />
                        {org.days_to_due !== null && (
                          <p
                            className={`mt-1 text-[11px] ${org.days_to_due < 0 ? "text-red-400" : org.days_to_due <= 7 ? "text-amber-400" : "text-slate-400"}`}
                            data-testid={`platform-org-due-days-${org.id}`}
                          >
                            {org.days_to_due < 0
                              ? `${Math.abs(org.days_to_due)} dia(s) em atraso`
                              : org.days_to_due === 0
                                ? "vence hoje"
                                : `vence em ${org.days_to_due} dia(s)`}
                          </p>
                        )}
                      </TableCell>
                      <TableCell className="whitespace-nowrap font-mono text-xs tabular-nums text-slate-400">
                        {formatDateTime(org.created_at)}
                      </TableCell>
                      <TableCell className="text-right font-mono text-xs tabular-nums text-slate-300">
                        {org.user_count} usu. · {org.product_count} prod. · {org.sales_count} vendas
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex justify-end gap-1">
                          <Button
                            size="icon-sm"
                            variant="ghost"
                            aria-label="Editar dados da empresa"
                            data-testid={`platform-org-edit-btn-${org.id}`}
                            onClick={() => {
                              setEditing(org);
                              setEditForm({
                                name: org.name,
                                owner_name: org.owner_name,
                                owner_email: org.owner_email,
                              });
                            }}
                          >
                            <Pencil className="size-4 text-slate-300" />
                          </Button>
                          <Button
                            size="icon-sm"
                            variant="ghost"
                            aria-label="Redefinir acesso do administrador"
                            data-testid={`platform-org-reset-admin-btn-${org.id}`}
                            disabled={resetAdmin.isPending}
                            onClick={() => resetAdmin.mutate(org.id)}
                          >
                            <KeyRound className="size-4 text-amber-400" />
                          </Button>
                          {org.status !== "APROVADA" && (
                            <Button
                              size="sm"
                              data-testid={`platform-org-approve-btn-${org.id}`}
                              onClick={() => setStatus.mutate({ id: org.id, status: "APROVADA" })}
                            >
                              <CheckCircle2 className="size-4" />
                              {org.status === "PENDENTE" ? "Liberar" : "Reativar"}
                            </Button>
                          )}
                          {org.status === "APROVADA" && (
                            <Button
                              size="sm"
                              variant="outline"
                              className="border-white/20 bg-transparent text-white hover:bg-white/10"
                              data-testid={`platform-org-suspend-btn-${org.id}`}
                              onClick={() => setStatus.mutate({ id: org.id, status: "SUSPENSA" })}
                            >
                              <Ban className="size-4" />
                              Suspender
                            </Button>
                          )}
                          {org.status === "SUSPENSA" && (
                            <Button
                              size="icon-sm"
                              variant="ghost"
                              aria-label="Reativar empresa"
                              data-testid={`platform-org-reactivate-btn-${org.id}`}
                              onClick={() => setStatus.mutate({ id: org.id, status: "APROVADA" })}
                            >
                              <RotateCcw className="size-4 text-teal-400" />
                            </Button>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                  {orgs.length === 0 && (
                    <TableRow className="border-white/10">
                      <TableCell colSpan={8} className="py-10 text-center text-sm text-slate-400">
                        Nenhuma empresa cadastrada ainda.
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>

        <Card className="mt-6 border-white/10 bg-slate-900 shadow-none">
          <CardHeader>
            <CardTitle className="text-base font-bold tracking-tight text-white">
              Usuários da plataforma
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <Table data-testid="platform-users-table">
                <TableHeader>
                  <TableRow className="border-white/10 hover:bg-transparent">
                    <TableHead className="text-slate-400">Usuário</TableHead>
                    <TableHead className="text-slate-400">Empresa</TableHead>
                    <TableHead className="text-slate-400">Perfil</TableHead>
                    <TableHead className="text-slate-400">Situação</TableHead>
                    <TableHead className="text-slate-400">Último login</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {users.map((item) => (
                    <TableRow
                      key={item.id}
                      className="border-white/10 hover:bg-white/5"
                      data-testid={`platform-user-row-${item.id}`}
                    >
                      <TableCell>
                        <p className="font-semibold text-white">{item.name}</p>
                        <p className="text-xs text-slate-400">{item.email}</p>
                      </TableCell>
                      <TableCell className="text-slate-300">{item.org_name}</TableCell>
                      <TableCell className="text-slate-300">{ROLE_LABELS[item.role]}</TableCell>
                      <TableCell>
                        <span
                          className={
                            item.is_active
                              ? "font-medium text-emerald-400"
                              : "font-medium text-slate-500"
                          }
                        >
                          {item.is_active ? "Ativo" : "Bloqueado"}
                        </span>
                      </TableCell>
                      <TableCell className="font-mono text-xs tabular-nums text-slate-400">
                        {item.last_login_at ? formatDateTime(item.last_login_at) : "nunca entrou"}
                      </TableCell>
                    </TableRow>
                  ))}
                  {users.length === 0 && (
                    <TableRow className="border-white/10">
                      <TableCell colSpan={5} className="py-10 text-center text-sm text-slate-400">
                        Nenhum usuário cadastrado.
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>

        <p className="mt-6 rounded-xl border border-white/10 bg-slate-900 p-5 text-sm text-slate-400">
          <strong className="text-slate-200">Cobrança:</strong> planos e status de assinatura já
          estão estruturados (teste, ativo, inadimplente, cancelado), mas nenhuma cobrança real é
          feita — a integração com o provedor de pagamentos será implementada depois. Alterar o
          status aqui só muda o acesso: <em>cancelado</em> bloqueia o login da empresa,{" "}
          <em>inadimplente</em> apenas sinaliza e mantém o acesso.
        </p>
      </main>

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="sm:max-w-lg" data-testid="platform-create-org-dialog">
          <DialogHeader>
            <DialogTitle>Nova empresa cliente</DialogTitle>
            <DialogDescription>
              A empresa já nasce liberada com o workspace próprio e isolado. A senha do
              administrador é gerada automaticamente e exibida uma única vez.
            </DialogDescription>
          </DialogHeader>
          <form
            className="grid gap-4"
            onSubmit={(event) => {
              event.preventDefault();
              createOrg.mutate();
            }}
          >
            <div className="grid gap-2">
              <Label htmlFor="org-company">Nome da empresa</Label>
              <Input
                id="org-company"
                required
                minLength={2}
                data-testid="platform-create-company-input"
                value={form.company_name}
                onChange={(e) => setForm({ ...form, company_name: e.target.value })}
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="org-owner">Responsável (administrador)</Label>
              <Input
                id="org-owner"
                required
                minLength={2}
                data-testid="platform-create-owner-input"
                value={form.owner_name}
                onChange={(e) => setForm({ ...form, owner_name: e.target.value })}
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="org-email">E-mail de acesso</Label>
              <Input
                id="org-email"
                type="email"
                required
                data-testid="platform-create-email-input"
                value={form.owner_email}
                onChange={(e) => setForm({ ...form, owner_email: e.target.value })}
              />
            </div>
            <div className="grid gap-2 sm:grid-cols-2">
              <div className="grid gap-2">
                <Label>Plano</Label>
                <Select
                  value={form.plan}
                  onValueChange={(value: string) => setForm({ ...form, plan: value as Plan })}
                >
                  <SelectTrigger data-testid="platform-create-plan-select">
                    <SelectValue>{(value) => PLAN_LABELS[value as Plan]}</SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    {PLANS.map((plan) => (
                      <SelectItem key={plan} value={plan}>
                        {PLAN_LABELS[plan]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="grid gap-2">
                <Label>Assinatura</Label>
                <Select
                  value={form.subscription_status}
                  onValueChange={(value: string) =>
                    setForm({ ...form, subscription_status: value as SubscriptionStatus })
                  }
                >
                  <SelectTrigger data-testid="platform-create-subscription-select">
                    <SelectValue>
                      {(value) => SUBSCRIPTION_LABELS[value as SubscriptionStatus]}
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    {SUBSCRIPTIONS.map((status) => (
                      <SelectItem key={status} value={status}>
                        {SUBSCRIPTION_LABELS[status]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <DialogFooter>
              <Button
                type="submit"
                disabled={createOrg.isPending}
                data-testid="platform-create-submit-button"
              >
                {createOrg.isPending ? "Criando..." : "Criar e liberar acesso"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={editing !== null} onOpenChange={(open) => !open && setEditing(null)}>
        <DialogContent className="sm:max-w-lg" data-testid="platform-edit-org-dialog">
          <DialogHeader>
            <DialogTitle>Editar empresa</DialogTitle>
            <DialogDescription>
              Alterar o e-mail aqui também muda o login do administrador da empresa.
            </DialogDescription>
          </DialogHeader>
          <form
            className="grid gap-4"
            onSubmit={(event) => {
              event.preventDefault();
              if (editing) updateOrg.mutate({ id: editing.id, ...editForm });
            }}
          >
            <div className="grid gap-2">
              <Label htmlFor="edit-name">Nome da empresa</Label>
              <Input
                id="edit-name"
                required
                minLength={2}
                data-testid="platform-edit-company-input"
                value={editForm.name}
                onChange={(e) => setEditForm({ ...editForm, name: e.target.value })}
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="edit-owner">Responsável</Label>
              <Input
                id="edit-owner"
                required
                minLength={2}
                data-testid="platform-edit-owner-input"
                value={editForm.owner_name}
                onChange={(e) => setEditForm({ ...editForm, owner_name: e.target.value })}
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="edit-email">E-mail de acesso</Label>
              <Input
                id="edit-email"
                type="email"
                required
                data-testid="platform-edit-email-input"
                value={editForm.owner_email}
                onChange={(e) => setEditForm({ ...editForm, owner_email: e.target.value })}
              />
            </div>
            <DialogFooter>
              <Button
                type="submit"
                disabled={updateOrg.isPending}
                data-testid="platform-edit-submit-button"
              >
                {updateOrg.isPending ? "Salvando..." : "Salvar"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog
        open={credentials !== null}
        onOpenChange={(open) => !open && setCredentials(null)}
      >
        <DialogContent className="sm:max-w-md" data-testid="platform-credentials-dialog">
          <DialogHeader>
            <DialogTitle>Acesso da empresa</DialogTitle>
            <DialogDescription>{credentials?.message}</DialogDescription>
          </DialogHeader>
          {credentials && (
            <div className="grid gap-3">
              <div className="rounded-lg border bg-muted/40 p-4">
                <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Empresa
                </p>
                <p className="font-semibold" data-testid="platform-credentials-org">
                  {credentials.organization.name}
                </p>
                <p className="mt-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  E-mail
                </p>
                <p className="font-mono text-sm" data-testid="platform-credentials-email">
                  {credentials.admin_email}
                </p>
                <p className="mt-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Senha
                </p>
                <p className="font-mono text-lg font-semibold" data-testid="platform-credentials-password">
                  {credentials.admin_password}
                </p>
              </div>
              <Button
                variant="outline"
                data-testid="platform-credentials-copy-button"
                onClick={() => {
                  void navigator.clipboard?.writeText(
                    `Acesso ${credentials.organization.name}\nE-mail: ${credentials.admin_email}\nSenha: ${credentials.admin_password}`
                  );
                  toast.success("Acesso copiado");
                }}
              >
                <Copy className="size-4" />
                Copiar acesso
              </Button>
              <p className="text-xs text-muted-foreground">
                {credentials.email_sent
                  ? "Um e-mail de boas-vindas foi enviado ao responsável."
                  : "Repasse estes dados ao cliente — a senha não é exibida novamente."}
              </p>
            </div>
          )}
        </DialogContent>
      </Dialog>
      <Toaster richColors />
    </div>
  );
}
