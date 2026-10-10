import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  ArchiveRestore,
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
  DatabaseBackup,
  Download,
  ScrollText,
  TrendingUp,
  ShieldCheck,
  Trash2,
  Users,
} from "lucide-react";
import { toast } from "sonner";
import { apiDelete, apiGet, apiPost, apiPut } from "@/lib/api";
import type {
  OrgCredentials,
  BackupRecord,
  BackupSettings,
  DeleteResult,
  RestoreResult,
  PlanLimit,
  PlanLimits,
  PlanPrices,
  PlatformLog,
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
import { Checkbox } from "@/components/ui/checkbox";
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

/** Conta sem uso: nenhuma venda e nenhum produto cadastrado (típico de cadastro de teste). */
const isUnused = (org: PlatformOrgView) =>
  org.sales_count === 0 && org.product_count === 0 && org.subscription_status !== "ATIVO";

const OFFSITE_LABELS: Record<string, string> = {
  ENVIADO: "cópia externa ok",
  FALHOU: "cópia externa falhou",
  NAO_CONFIGURADO: "só no servidor",
};

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
  const [limitsDraft, setLimitsDraft] = useState<Record<string, PlanLimit> | null>(null);
  const [extrasOrg, setExtrasOrg] = useState<PlatformOrgView | null>(null);
  const [extras, setExtras] = useState({ extra_users: "0", extra_products: "0" });
  // remoção de contas
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [deletingOrg, setDeletingOrg] = useState<PlatformOrgView | null>(null);
  const [deleteName, setDeleteName] = useState("");
  const [bulkOpen, setBulkOpen] = useState(false);
  const [bulkConfirm, setBulkConfirm] = useState("");
  const [deletingUser, setDeletingUser] = useState<PlatformUserView | null>(null);
  // restauração de backup
  const [restoreBackup, setRestoreBackup] = useState<BackupRecord | null>(null);
  const [restoreOrgId, setRestoreOrgId] = useState("");
  const [restorePreview, setRestorePreview] = useState<RestoreResult | null>(null);

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
  const { data: planLimits } = useQuery({
    queryKey: ["platform-plan-limits"],
    queryFn: () => apiGet<PlanLimits>("/platform/plan-limits"),
    refetchOnWindowFocus: false,
  });
  const { data: logData } = useQuery({
    queryKey: ["platform-logs"],
    queryFn: () => apiGet<PlatformLog[]>("/platform/logs?limit=50"),
    refetchOnWindowFocus: false,
  });
  const { data: backupData } = useQuery({
    queryKey: ["platform-backups"],
    queryFn: () => apiGet<BackupRecord[]>("/platform/backups"),
    refetchOnWindowFocus: false,
  });
  const { data: backupSettings } = useQuery({
    queryKey: ["platform-backup-settings"],
    queryFn: () => apiGet<BackupSettings>("/platform/backups/settings"),
    refetchOnWindowFocus: false,
  });
  const { data: backupOrgs } = useQuery({
    queryKey: ["platform-backup-orgs", restoreBackup?.file],
    queryFn: () =>
      apiGet<{ id: string; name: string; exists_now: boolean }[]>(
        `/platform/backups/${restoreBackup?.file}/organizations`,
      ),
    enabled: restoreBackup !== null,
    refetchOnWindowFocus: false,
  });
  const { data: userData } = useQuery({
    queryKey: ["platform-users"],
    queryFn: () => apiGet<PlatformUserView[]>("/platform/users"),
    refetchOnWindowFocus: false,
  });

  const orgs = orgError ? [] : (orgData ?? []);
  const users = userData ?? [];
  const unusedOrgs = orgs.filter(isUnused);
  const selectedOrgs = orgs.filter((org) => selected.has(org.id));
  const allSelected = orgs.length > 0 && selectedOrgs.length === orgs.length;

  const toggleSelected = (id: string, checked: boolean) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (checked) next.add(id);
      else next.delete(id);
      return next;
    });

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ["platform-stats"] });
    void queryClient.invalidateQueries({ queryKey: ["platform-orgs"] });
    void queryClient.invalidateQueries({ queryKey: ["platform-users"] });
    void queryClient.invalidateQueries({ queryKey: ["platform-revenue"] });
    void queryClient.invalidateQueries({ queryKey: ["platform-logs"] });
    void queryClient.invalidateQueries({ queryKey: ["platform-backups"] });
  };

  const deleteOrg = useMutation({
    mutationFn: ({ id, confirm_name }: { id: string; confirm_name: string }) =>
      apiDelete<DeleteResult>(`/platform/organizations/${id}`, { confirm_name }),
    onSuccess: (result, variables) => {
      setDeletingOrg(null);
      setDeleteName("");
      toggleSelected(variables.id, false);
      toast.success(result.message);
      refresh();
    },
    onError: (error) => toast.error(errorMessage(error, "Não foi possível excluir a empresa")),
  });

  const bulkDelete = useMutation({
    mutationFn: (ids: string[]) =>
      apiPost<DeleteResult>("/platform/organizations/bulk-delete", { ids, confirm: bulkConfirm }),
    onSuccess: (result) => {
      setBulkOpen(false);
      setBulkConfirm("");
      setSelected(new Set());
      toast.success(result.message);
      refresh();
    },
    onError: (error) => toast.error(errorMessage(error, "Não foi possível excluir as empresas")),
  });

  const deleteUser = useMutation({
    mutationFn: (id: string) => apiDelete<void>(`/platform/users/${id}`),
    onSuccess: () => {
      setDeletingUser(null);
      toast.success("Usuário removido");
      refresh();
    },
    onError: (error) => toast.error(errorMessage(error, "Não foi possível remover o usuário")),
  });

  const restore = useMutation({
    mutationFn: ({ file, org_id, confirm }: { file: string; org_id: string; confirm: boolean }) =>
      apiPost<RestoreResult>(`/platform/backups/${file}/restore`, { org_id, confirm }),
    onSuccess: (result) => {
      if (result.applied) {
        setRestoreBackup(null);
        setRestorePreview(null);
        setRestoreOrgId("");
        toast.success(result.message);
        refresh();
      } else {
        setRestorePreview(result);
      }
    },
    onError: (error) => toast.error(errorMessage(error, "Não foi possível restaurar")),
  });

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
    void queryClient.invalidateQueries({ queryKey: ["platform-logs"] });
    },
    onError: (error) => toast.error(errorMessage(error, "Não foi possível salvar os preços")),
  });

  const saveLimits = useMutation({
    mutationFn: (draft: Record<string, PlanLimit>) =>
      apiPut<PlanLimits>("/platform/plan-limits", { limits: draft }),
    onSuccess: () => {
      setLimitsDraft(null);
      toast.success("Limites dos planos atualizados");
      void queryClient.invalidateQueries({ queryKey: ["platform-plan-limits"] });
      void queryClient.invalidateQueries({ queryKey: ["platform-logs"] });
    },
    onError: (error) => toast.error(errorMessage(error, "Não foi possível salvar os limites")),
  });

  const saveExtras = useMutation({
    mutationFn: ({ id, extra_users, extra_products }: { id: string; extra_users: number; extra_products: number }) =>
      apiPut(`/platform/organizations/${id}/limits`, { extra_users, extra_products }),
    onSuccess: () => {
      setExtrasOrg(null);
      toast.success("Exceção de limite salva");
      refresh();
    },
    onError: (error) => toast.error(errorMessage(error, "Não foi possível salvar a exceção")),
  });

  const runBackup = useMutation({
    mutationFn: () => apiPost<BackupRecord>("/platform/backups/run"),
    onSuccess: (result) => {
      if (result.status === "OK") {
        toast.success(`Backup criado: ${result.file}`);
      } else {
        toast.error(`Backup falhou: ${result.error}`);
      }
      void queryClient.invalidateQueries({ queryKey: ["platform-backups"] });
      void queryClient.invalidateQueries({ queryKey: ["platform-logs"] });
    },
    onError: (error) => toast.error(errorMessage(error, "Não foi possível gerar o backup")),
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
            <p className="mt-3 text-xs text-slate-400" data-testid="platform-received-30d">
              Recebido pelo Mercado Pago nos últimos 30 dias:{" "}
              <strong className="font-mono text-emerald-400">
                {money(revenue?.received_last_30d ?? 0)}
              </strong>
            </p>

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
              Quem assina pelo Mercado Pago é cobrado no cartão todo mês e o sistema ativa,
              marca atraso e suspende (após 5 dias) sozinho. Para quem paga por fora (Pix, link),
              os avisos de vencimento vão ao e-mail do responsável 7, 3 e 1 dia antes e no dia —
              defina a data na coluna “Vencimento” abaixo.
            </p>
          </CardContent>
        </Card>

        <Card className="mb-6 border-white/10 bg-slate-900 shadow-none" data-testid="platform-limits-card">
          <CardHeader className="flex flex-row items-center justify-between gap-4">
            <CardTitle className="text-base font-bold tracking-tight text-white">
              Limites dos planos
            </CardTitle>
            {limitsDraft ? (
              <Button
                size="sm"
                data-testid="platform-save-limits-button"
                disabled={saveLimits.isPending}
                onClick={() => saveLimits.mutate(limitsDraft)}
              >
                <Save className="size-4" />
                Salvar limites
              </Button>
            ) : (
              <Button
                size="sm"
                variant="outline"
                className="border-white/20 bg-transparent text-white hover:bg-white/10"
                data-testid="platform-edit-limits-button"
                disabled={!planLimits}
                onClick={() => planLimits && setLimitsDraft(structuredClone(planLimits.limits))}
              >
                <Pencil className="size-4" />
                Editar limites
              </Button>
            )}
          </CardHeader>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow className="border-white/10 hover:bg-transparent">
                    <TableHead className="text-slate-400">Plano</TableHead>
                    <TableHead className="text-slate-400">Usuários</TableHead>
                    <TableHead className="text-slate-400">Produtos</TableHead>
                    <TableHead className="text-slate-400">Histórico (meses)</TableHead>
                    <TableHead className="text-slate-400">Relatório completo</TableHead>
                    <TableHead className="text-slate-400">Logo no cupom</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {PLANS.map((plan) => {
                    const row = (limitsDraft ?? planLimits?.limits)?.[plan];
                    if (!row) return null;
                    const setNum = (field: "users" | "products" | "history_months", value: string) =>
                      limitsDraft &&
                      setLimitsDraft({
                        ...limitsDraft,
                        [plan]: { ...row, [field]: value.trim() === "" ? null : Math.max(0, Number(value) || 0) },
                      });
                    const setBool = (field: "full_report" | "branding", value: boolean) =>
                      limitsDraft && setLimitsDraft({ ...limitsDraft, [plan]: { ...row, [field]: value } });
                    const numCell = (field: "users" | "products" | "history_months") =>
                      limitsDraft ? (
                        <Input
                          inputMode="numeric"
                          placeholder="ilimitado"
                          className="w-28 border-white/20 bg-slate-800 text-white"
                          value={row[field] ?? ""}
                          onChange={(e) => setNum(field, e.target.value)}
                          data-testid={`platform-limit-${plan}-${field}`}
                        />
                      ) : (
                        <span className="font-mono tabular-nums text-slate-200">{row[field] ?? "ilimitado"}</span>
                      );
                    const boolCell = (field: "full_report" | "branding") =>
                      limitsDraft ? (
                        <Checkbox
                          checked={row[field]}
                          onCheckedChange={(checked) => setBool(field, checked === true)}
                          aria-label={field}
                        />
                      ) : (
                        <span className={row[field] ? "text-emerald-400" : "text-slate-500"}>
                          {row[field] ? "sim" : "não"}
                        </span>
                      );
                    return (
                      <TableRow key={plan} className="border-white/10 hover:bg-white/5">
                        <TableCell className="font-semibold text-white">{PLAN_LABELS[plan]}</TableCell>
                        <TableCell>{numCell("users")}</TableCell>
                        <TableCell>{numCell("products")}</TableCell>
                        <TableCell>{numCell("history_months")}</TableCell>
                        <TableCell>{boolCell("full_report")}</TableCell>
                        <TableCell>{boolCell("branding")}</TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
            <p className="px-6 py-4 text-xs text-slate-500">
              Campo vazio = ilimitado. O período de teste usa a linha “Período de teste”. Para
              liberar algo a mais só para uma loja, use o botão de exceção na lista de empresas.
            </p>
          </CardContent>
        </Card>

        <Card className="border-white/10 bg-slate-900 shadow-none">
          <CardHeader className="flex flex-row items-center justify-between gap-4">
            <CardTitle className="text-base font-bold tracking-tight text-white">
              Empresas cadastradas
            </CardTitle>
            <div className="flex flex-wrap items-center justify-end gap-2">
            {unusedOrgs.length > 0 && (
              <Button
                size="sm"
                variant="outline"
                className="border-white/20 bg-transparent text-white hover:bg-white/10"
                data-testid="platform-select-unused-button"
                title="Marca as empresas sem nenhuma venda e sem produtos cadastrados (que não estão com assinatura ativa)"
                onClick={() => setSelected(new Set(unusedOrgs.map((org) => org.id)))}
              >
                Selecionar sem uso ({unusedOrgs.length})
              </Button>
            )}
            {selectedOrgs.length > 0 && (
              <Button
                size="sm"
                variant="destructive"
                data-testid="platform-bulk-delete-button"
                onClick={() => {
                  setBulkConfirm("");
                  setBulkOpen(true);
                }}
              >
                <Trash2 className="size-4" />
                Excluir selecionadas ({selectedOrgs.length})
              </Button>
            )}
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
            </div>
          </CardHeader>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <Table data-testid="platform-orgs-table">
                <TableHeader>
                  <TableRow className="border-white/10 hover:bg-transparent">
                    <TableHead className="w-10">
                      <Checkbox
                        checked={allSelected}
                        onCheckedChange={(checked) =>
                          setSelected(checked === true ? new Set(orgs.map((org) => org.id)) : new Set())
                        }
                        aria-label="Selecionar todas as empresas"
                        data-testid="platform-org-select-all"
                      />
                    </TableHead>
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
                        <Checkbox
                          checked={selected.has(org.id)}
                          onCheckedChange={(checked) => toggleSelected(org.id, checked === true)}
                          aria-label={`Selecionar ${org.name}`}
                          data-testid={`platform-org-select-${org.id}`}
                        />
                      </TableCell>
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
                        {org.trial_expired ? (
                          <p
                            className="mt-1 text-[11px] font-semibold text-red-400"
                            data-testid={`platform-org-trial-expired-${org.id}`}
                            title="A empresa está bloqueada. Mude para um plano pago com assinatura Ativa, ou escolha uma nova data de vencimento para prorrogar o teste."
                          >
                            Teste encerrado · empresa bloqueada
                          </p>
                        ) : (
                          org.trial_days_left !== null &&
                          org.plan === "TESTE" && (
                            <p className="mt-1 text-[11px] text-slate-400">
                              {org.trial_days_left} dias de teste restantes
                            </p>
                          )
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
                        {org.mp_status && (
                          <p className="mt-1 text-[11px] text-slate-400" data-testid={`platform-org-mp-${org.id}`}>
                            Mercado Pago: {org.mp_status === "authorized" ? "cartão ativo" : org.mp_status}
                          </p>
                        )}
                        {org.payment_failed_at && (
                          <p className="mt-1 text-[11px] font-semibold text-amber-400">
                            pagamento recusado em {formatDateTime(org.payment_failed_at)}
                          </p>
                        )}
                        {org.suspended_reason === "PAGAMENTO" && (
                          <p className="mt-1 text-[11px] font-semibold text-red-400">suspensa por falta de pagamento</p>
                        )}
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
                        {isUnused(org) && (
                          <span className="ml-2 rounded border border-white/15 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-slate-400">
                            sem uso
                          </span>
                        )}
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
                          <Button
                            size="icon-sm"
                            variant="ghost"
                            aria-label={`Exceção de limite para ${org.name}`}
                            title={
                              org.extra_users || org.extra_products
                                ? `Exceção: +${org.extra_users} usuário(s), +${org.extra_products} produto(s)`
                                : "Liberar usuários/produtos a mais só para esta loja"
                            }
                            data-testid={`platform-org-extras-btn-${org.id}`}
                            onClick={() => {
                              setExtras({
                                extra_users: String(org.extra_users ?? 0),
                                extra_products: String(org.extra_products ?? 0),
                              });
                              setExtrasOrg(org);
                            }}
                          >
                            <Plus
                              className={`size-4 ${org.extra_users || org.extra_products ? "text-teal-400" : "text-slate-400"}`}
                            />
                          </Button>
                          <Button
                            size="icon-sm"
                            variant="ghost"
                            aria-label={`Excluir ${org.name}`}
                            title="Excluir empresa e todos os dados dela"
                            data-testid={`platform-org-delete-btn-${org.id}`}
                            onClick={() => {
                              setDeleteName("");
                              setDeletingOrg(org);
                            }}
                          >
                            <Trash2 className="size-4 text-red-400" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                  {orgs.length === 0 && (
                    <TableRow className="border-white/10">
                      <TableCell colSpan={9} className="py-10 text-center text-sm text-slate-400">
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
                    <TableHead className="text-right text-slate-400">Ações</TableHead>
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
                      <TableCell className="text-right">
                        {item.role !== "PLATFORM_OWNER" && (
                          <Button
                            size="icon-sm"
                            variant="ghost"
                            aria-label={`Remover ${item.email}`}
                            title="Remover este usuário"
                            data-testid={`platform-user-delete-btn-${item.id}`}
                            onClick={() => setDeletingUser(item)}
                          >
                            <Trash2 className="size-4 text-red-400" />
                          </Button>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                  {users.length === 0 && (
                    <TableRow className="border-white/10">
                      <TableCell colSpan={6} className="py-10 text-center text-sm text-slate-400">
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
          <em>inadimplente</em> apenas sinaliza e mantém o acesso. Automático: quando o{" "}
          <em>teste grátis</em> termina, a empresa fica bloqueada até você mudar o plano para pago
          (assinatura <em>ativo</em>) ou escolher uma nova data na coluna Vencimento para prorrogar o
          teste; quando o vencimento de uma assinatura <em>ativa</em> passa, ela vira{" "}
          <em>inadimplente</em> sozinha.
        </p>
        <div className="mt-6 grid gap-6 lg:grid-cols-2">
          <Card className="border-white/10 bg-slate-900 shadow-none">
            <CardHeader className="flex flex-row items-center justify-between gap-4">
              <CardTitle className="flex items-center gap-2 text-base font-bold tracking-tight text-white">
                <DatabaseBackup className="size-4 text-teal-400" />
                Backups do banco
              </CardTitle>
              <Button
                size="sm"
                variant="outline"
                className="border-white/20 bg-transparent text-white hover:bg-white/10"
                data-testid="platform-run-backup-button"
                disabled={runBackup.isPending}
                onClick={() => runBackup.mutate()}
              >
                <DatabaseBackup className="size-4" />
                {runBackup.isPending ? "Gerando..." : "Gerar agora"}
              </Button>
            </CardHeader>
            <CardContent>
              <p className="mb-3 text-xs text-slate-400">
                Automático todo dia às 6h (horário de Brasília). Mantemos os{" "}
                {backupSettings?.keep ?? 7} mais recentes no servidor. Antes de excluir ou restaurar
                uma empresa, um backup novo é feito sozinho.
              </p>
              {backupSettings && !backupSettings.offsite_configured && (
                <div
                  className="mb-3 flex gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-200"
                  data-testid="platform-backup-offsite-warning"
                >
                  <AlertTriangle className="size-4 shrink-0 text-amber-400" />
                  <span>
                    A cópia fora do servidor ainda não está ligada: se o servidor tiver um problema,
                    os backups somem junto. Ligue o armazenamento externo (veja o guia) ou baixe um
                    backup por semana e guarde no seu computador.
                  </span>
                </div>
              )}
              <div className="space-y-2" data-testid="platform-backups-list">
                {(backupData ?? []).length === 0 && (
                  <p className="py-6 text-center text-sm text-slate-400">
                    Nenhum backup registrado ainda.
                  </p>
                )}
                {(backupData ?? []).map((backup) => (
                  <div
                    key={backup.id}
                    className="flex items-center justify-between gap-3 rounded-lg border border-white/10 bg-slate-800/60 px-3 py-2"
                    data-testid={`platform-backup-row-${backup.id}`}
                  >
                    <div className="min-w-0">
                      <p className="truncate font-mono text-xs text-slate-200">{backup.file}</p>
                      <p className="text-[11px] text-slate-400">
                        {formatDateTime(backup.created_at)} ·{" "}
                        {backup.status === "OK"
                          ? `${(backup.size_bytes / 1024).toFixed(0)} KB`
                          : `falhou — ${backup.error}`}
                        {backup.status === "OK" && OFFSITE_LABELS[backup.offsite] && (
                          <span
                            className={
                              backup.offsite === "ENVIADO"
                                ? " text-emerald-400"
                                : backup.offsite === "FALHOU"
                                  ? " text-red-400"
                                  : " text-slate-500"
                            }
                          >
                            {" "}
                            · {OFFSITE_LABELS[backup.offsite]}
                          </span>
                        )}
                      </p>
                    </div>
                    {backup.status === "OK" && (
                      <div className="flex shrink-0 gap-1">
                      <button
                        type="button"
                        className="inline-flex shrink-0 items-center gap-1 rounded-lg border border-white/20 px-2 py-1 text-xs font-semibold text-white transition-colors duration-150 hover:bg-white/10"
                        data-testid={`platform-backup-restore-${backup.id}`}
                        onClick={() => {
                          setRestorePreview(null);
                          setRestoreOrgId("");
                          setRestoreBackup(backup);
                        }}
                      >
                        <ArchiveRestore className="size-3.5" />
                        Restaurar
                      </button>
                      <a
                        href={`/api/platform/backups/${backup.file}/download`}
                        className="inline-flex shrink-0 items-center gap-1 rounded-lg border border-white/20 px-2 py-1 text-xs font-semibold text-white transition-colors duration-150 hover:bg-white/10"
                        data-testid={`platform-backup-download-${backup.id}`}
                      >
                        <Download className="size-3.5" />
                        Baixar
                      </a>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>

          <Card className="border-white/10 bg-slate-900 shadow-none">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base font-bold tracking-tight text-white">
                <ScrollText className="size-4 text-teal-400" />
                Minhas ações na plataforma
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="max-h-[420px] space-y-2 overflow-y-auto" data-testid="platform-logs-list">
                {(logData ?? []).length === 0 && (
                  <p className="py-6 text-center text-sm text-slate-400">
                    Nenhuma ação registrada ainda.
                  </p>
                )}
                {(logData ?? []).map((log) => (
                  <div
                    key={log.id}
                    className="rounded-lg border border-white/10 bg-slate-800/60 px-3 py-2"
                    data-testid={`platform-log-row-${log.id}`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-mono text-[11px] font-semibold uppercase tracking-wider text-teal-400">
                        {log.action}
                      </span>
                      <span className="shrink-0 font-mono text-[11px] tabular-nums text-slate-400">
                        {formatDateTime(log.created_at)}
                      </span>
                    </div>
                    <p className="text-sm font-semibold text-white">{log.target}</p>
                    <p className="text-xs text-slate-400">{log.details}</p>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </div>
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

      <Dialog open={extrasOrg !== null} onOpenChange={(open) => !open && setExtrasOrg(null)}>
        <DialogContent className="sm:max-w-sm" data-testid="platform-extras-dialog">
          <DialogHeader>
            <DialogTitle>Exceção de limite</DialogTitle>
            <DialogDescription>
              Quantidade a mais, além do plano, só para <strong>{extrasOrg?.name}</strong>.
            </DialogDescription>
          </DialogHeader>
          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-1.5">
              <Label htmlFor="extra-users">Usuários a mais</Label>
              <Input
                id="extra-users"
                inputMode="numeric"
                value={extras.extra_users}
                onChange={(e) => setExtras({ ...extras, extra_users: e.target.value })}
                data-testid="platform-extra-users-input"
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="extra-products">Produtos a mais</Label>
              <Input
                id="extra-products"
                inputMode="numeric"
                value={extras.extra_products}
                onChange={(e) => setExtras({ ...extras, extra_products: e.target.value })}
                data-testid="platform-extra-products-input"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setExtrasOrg(null)}>
              Cancelar
            </Button>
            <Button
              disabled={saveExtras.isPending}
              data-testid="platform-extras-save-button"
              onClick={() =>
                extrasOrg &&
                saveExtras.mutate({
                  id: extrasOrg.id,
                  extra_users: Math.max(0, Number(extras.extra_users) || 0),
                  extra_products: Math.max(0, Number(extras.extra_products) || 0),
                })
              }
            >
              Salvar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={deletingOrg !== null}
        onOpenChange={(open) => !open && setDeletingOrg(null)}
      >
        <DialogContent className="sm:max-w-md" data-testid="platform-delete-org-dialog">
          <DialogHeader>
            <DialogTitle>Excluir empresa</DialogTitle>
            <DialogDescription>
              Apaga <strong>{deletingOrg?.name}</strong> com todos os usuários, produtos, vendas,
              devoluções e movimentações. Um backup é feito antes, então dá para trazer de volta pela
              restauração de backup.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-2">
            <Label htmlFor="delete-org-name">Digite o nome da empresa para confirmar</Label>
            <Input
              id="delete-org-name"
              autoComplete="off"
              placeholder={deletingOrg?.name}
              value={deleteName}
              onChange={(e) => setDeleteName(e.target.value)}
              data-testid="platform-delete-org-name-input"
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeletingOrg(null)}>
              Cancelar
            </Button>
            <Button
              variant="destructive"
              disabled={
                !deletingOrg ||
                deleteName.trim() !== deletingOrg.name.trim() ||
                deleteOrg.isPending
              }
              data-testid="platform-delete-org-confirm-button"
              onClick={() =>
                deletingOrg && deleteOrg.mutate({ id: deletingOrg.id, confirm_name: deleteName })
              }
            >
              <Trash2 className="size-4" />
              {deleteOrg.isPending ? "Excluindo..." : "Excluir definitivamente"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={bulkOpen} onOpenChange={setBulkOpen}>
        <DialogContent className="sm:max-w-md" data-testid="platform-bulk-delete-dialog">
          <DialogHeader>
            <DialogTitle>Excluir {selectedOrgs.length} empresa(s)</DialogTitle>
            <DialogDescription>
              Todas serão apagadas com seus usuários e dados. Um backup é feito antes.
            </DialogDescription>
          </DialogHeader>
          <ul className="max-h-40 space-y-1 overflow-y-auto rounded-lg border p-3 text-sm">
            {selectedOrgs.map((org) => (
              <li key={org.id} className="flex justify-between gap-3">
                <span className="truncate font-medium">{org.name}</span>
                <span className="shrink-0 text-xs text-muted-foreground">
                  {org.sales_count} vendas · {org.product_count} prod.
                </span>
              </li>
            ))}
          </ul>
          {selectedOrgs.some((org) => !isUnused(org)) && (
            <p className="text-xs font-medium text-red-600">
              Atenção: há empresas com vendas, produtos ou assinatura ativa na seleção.
            </p>
          )}
          <div className="grid gap-2">
            <Label htmlFor="bulk-confirm">Digite EXCLUIR para confirmar</Label>
            <Input
              id="bulk-confirm"
              autoComplete="off"
              value={bulkConfirm}
              onChange={(e) => setBulkConfirm(e.target.value)}
              data-testid="platform-bulk-delete-confirm-input"
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setBulkOpen(false)}>
              Cancelar
            </Button>
            <Button
              variant="destructive"
              disabled={bulkConfirm.trim().toUpperCase() !== "EXCLUIR" || bulkDelete.isPending}
              data-testid="platform-bulk-delete-confirm-button"
              onClick={() => bulkDelete.mutate(selectedOrgs.map((org) => org.id))}
            >
              <Trash2 className="size-4" />
              {bulkDelete.isPending ? "Excluindo..." : "Excluir todas"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={deletingUser !== null}
        onOpenChange={(open) => !open && setDeletingUser(null)}
      >
        <DialogContent className="sm:max-w-md" data-testid="platform-delete-user-dialog">
          <DialogHeader>
            <DialogTitle>Remover usuário</DialogTitle>
            <DialogDescription>
              Remove o login <strong>{deletingUser?.email}</strong> ({deletingUser?.org_name}). A
              empresa e as vendas dela continuam.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeletingUser(null)}>
              Cancelar
            </Button>
            <Button
              variant="destructive"
              disabled={deleteUser.isPending}
              data-testid="platform-delete-user-confirm-button"
              onClick={() => deletingUser && deleteUser.mutate(deletingUser.id)}
            >
              <Trash2 className="size-4" />
              {deleteUser.isPending ? "Removendo..." : "Remover"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={restoreBackup !== null}
        onOpenChange={(open) => {
          if (!open) {
            setRestoreBackup(null);
            setRestorePreview(null);
          }
        }}
      >
        <DialogContent className="sm:max-w-lg" data-testid="platform-restore-dialog">
          <DialogHeader>
            <DialogTitle>Restaurar dados de uma empresa</DialogTitle>
            <DialogDescription>
              Devolve os dados da empresa escolhida como estavam no backup{" "}
              <span className="font-mono">{restoreBackup?.file}</span>. O que foi criado depois do
              backup não é apagado, e um backup do estado atual é feito antes.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-2">
            <Label>Empresa</Label>
            <Select
              value={restoreOrgId}
              onValueChange={(value: string) => {
                setRestoreOrgId(value);
                setRestorePreview(null);
              }}
            >
              <SelectTrigger data-testid="platform-restore-org-select">
                <SelectValue>
                  {(value) =>
                    (backupOrgs ?? []).find((org) => org.id === value)?.name ?? "Escolha a empresa"
                  }
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                {(backupOrgs ?? []).map((org) => (
                  <SelectItem key={org.id} value={org.id}>
                    {org.name}
                    {!org.exists_now && " (excluída)"}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              A lista mostra as empresas que existem neste backup — inclusive as excluídas, que
              voltam com usuários e dados.
            </p>
          </div>
          {restorePreview && (
            <div className="rounded-lg border bg-muted/40 p-3 text-sm" data-testid="platform-restore-preview">
              <p className="mb-2 font-semibold">
                No backup, {restorePreview.org_name} tem:
              </p>
              <ul className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
                {Object.entries(restorePreview.counts).map(([name, count]) => (
                  <li key={name} className="flex justify-between gap-2">
                    <span className="text-muted-foreground">{name}</span>
                    <span className="font-mono tabular-nums">{count}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setRestoreBackup(null)}>
              Cancelar
            </Button>
            {!restorePreview ? (
              <Button
                disabled={!restoreOrgId || restore.isPending}
                data-testid="platform-restore-preview-button"
                onClick={() =>
                  restoreBackup &&
                  restore.mutate({ file: restoreBackup.file, org_id: restoreOrgId, confirm: false })
                }
              >
                {restore.isPending ? "Conferindo..." : "Conferir"}
              </Button>
            ) : (
              <Button
                variant="destructive"
                disabled={restore.isPending}
                data-testid="platform-restore-confirm-button"
                onClick={() =>
                  restoreBackup &&
                  restore.mutate({ file: restoreBackup.file, org_id: restoreOrgId, confirm: true })
                }
              >
                <ArchiveRestore className="size-4" />
                {restore.isPending ? "Restaurando..." : "Restaurar agora"}
              </Button>
            )}
          </DialogFooter>
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
    </div>
  );
}
