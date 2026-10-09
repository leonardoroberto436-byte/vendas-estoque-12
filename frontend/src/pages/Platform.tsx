import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Ban,
  Building2,
  CheckCircle2,
  Clock,
  LogOut,
  RotateCcw,
  ShieldCheck,
  Users,
} from "lucide-react";
import { toast } from "sonner";
import { apiGet, apiPut } from "@/lib/api";
import type {
  Plan,
  PlatformOrgView,
  PlatformStats,
  PlatformUserView,
  SubscriptionStatus,
} from "@/lib/types";
import {
  ORG_STATUS_CLASSES,
  ORG_STATUS_LABELS,
  PLAN_LABELS,
  ROLE_LABELS,
  SUBSCRIPTION_CLASSES,
  SUBSCRIPTION_LABELS,
  errorMessage,
  formatDateTime,
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

const PLANS: Plan[] = ["TESTE", "BASICO", "PROFISSIONAL"];
const SUBSCRIPTIONS: SubscriptionStatus[] = ["TESTE", "ATIVO", "INADIMPLENTE", "CANCELADO"];

export default function Platform() {
  const queryClient = useQueryClient();
  const { user } = useCurrentUser();

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
  };

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
    }: {
      id: string;
      plan: Plan;
      subscription_status: SubscriptionStatus;
    }) => apiPut<PlatformOrgView>(`/platform/organizations/${id}/plan`, { plan, subscription_status }),
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

        <Card className="border-white/10 bg-slate-900 shadow-none">
          <CardHeader>
            <CardTitle className="text-base font-bold tracking-tight text-white">
              Empresas cadastradas
            </CardTitle>
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
                      <TableCell className="whitespace-nowrap font-mono text-xs tabular-nums text-slate-400">
                        {formatDateTime(org.created_at)}
                      </TableCell>
                      <TableCell className="text-right font-mono text-xs tabular-nums text-slate-300">
                        {org.user_count} usu. · {org.product_count} prod. · {org.sales_count} vendas
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex justify-end gap-1">
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
                      <TableCell colSpan={7} className="py-10 text-center text-sm text-slate-400">
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
      <Toaster richColors />
    </div>
  );
}
