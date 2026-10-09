import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { KeyRound, ShieldCheck, UserRound } from "lucide-react";
import { toast } from "sonner";
import { apiPost } from "@/lib/api";
import { errorMessage, formatDateTime } from "@/lib/format";
import { useCurrentUser } from "@/lib/useCurrentUser";
import AppShell from "@/components/AppShell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export default function Profile() {
  const { user } = useCurrentUser();
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState("");

  const change = useMutation({
    mutationFn: () =>
      apiPost<null>("/auth/change-password", {
        current_password: current,
        new_password: next,
      }),
    onSuccess: () => {
      toast.success("Senha alterada com sucesso");
      setCurrent("");
      setNext("");
      setConfirm("");
      setError("");
    },
    onError: (err) => setError(errorMessage(err, "Não foi possível alterar a senha")),
  });

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    setError("");
    if (next.length < 8) {
      setError("A nova senha precisa ter pelo menos 8 caracteres.");
      return;
    }
    if (next !== confirm) {
      setError("A confirmação não confere com a nova senha.");
      return;
    }
    if (next === current) {
      setError("A nova senha precisa ser diferente da atual.");
      return;
    }
    change.mutate();
  };

  return (
    <AppShell>
      <div className="mb-6">
        <h1 className="text-3xl font-bold tracking-tight text-slate-900">Meu Perfil</h1>
        <p className="mt-1 text-sm font-medium text-slate-500">
          Seus dados de acesso e troca de senha — sem depender do administrador
        </p>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
        <Card className="border-slate-200/90 shadow-xs lg:col-span-5">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base font-bold tracking-tight">
              <UserRound className="size-4 text-teal-600" />
              Dados da conta
            </CardTitle>
          </CardHeader>
          <CardContent>
            <dl className="space-y-4 text-sm">
              {[
                { label: "Nome", value: user?.name ?? "—", testId: "profile-name" },
                { label: "E-mail", value: user?.email ?? "—", testId: "profile-email" },
                {
                  label: "Perfil",
                  value: user ? (user.role === "ADMIN" ? "Administrador" : "Operador") : "—",
                  testId: "profile-role",
                },
                {
                  label: "Último login",
                  value: user?.last_login_at ? formatDateTime(user.last_login_at) : "—",
                  testId: "profile-last-login",
                },
              ].map((row) => (
                <div key={row.testId}>
                  <dt className="text-xs font-semibold uppercase tracking-wider text-slate-500">
                    {row.label}
                  </dt>
                  <dd className="mt-0.5 font-semibold text-slate-900" data-testid={row.testId}>
                    {row.value}
                  </dd>
                </div>
              ))}
            </dl>
            <p className="mt-5 flex items-start gap-2 rounded-lg bg-slate-50 p-3 text-xs text-slate-600">
              <ShieldCheck className="mt-0.5 size-4 shrink-0 text-slate-400" />
              Nome, e-mail e perfil são definidos pelo administrador. A senha é só sua.
            </p>
          </CardContent>
        </Card>

        <Card className="border-slate-200/90 shadow-xs lg:col-span-7">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base font-bold tracking-tight">
              <KeyRound className="size-4 text-teal-600" />
              Trocar minha senha
            </CardTitle>
          </CardHeader>
          <CardContent>
            <form onSubmit={submit} className="max-w-md space-y-4" data-testid="change-password-form">
              <div className="space-y-1.5">
                <Label htmlFor="cp-current">Senha atual</Label>
                <Input
                  id="cp-current"
                  type="password"
                  autoComplete="current-password"
                  value={current}
                  onChange={(event) => setCurrent(event.target.value)}
                  data-testid="change-password-current-input"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="cp-new">Nova senha (mín. 8 caracteres)</Label>
                <Input
                  id="cp-new"
                  type="password"
                  autoComplete="new-password"
                  value={next}
                  onChange={(event) => setNext(event.target.value)}
                  data-testid="change-password-new-input"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="cp-confirm">Confirmar nova senha</Label>
                <Input
                  id="cp-confirm"
                  type="password"
                  autoComplete="new-password"
                  value={confirm}
                  onChange={(event) => setConfirm(event.target.value)}
                  data-testid="change-password-confirm-input"
                />
              </div>

              {error && (
                <p
                  className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm font-medium text-red-700"
                  data-testid="change-password-error"
                >
                  {error}
                </p>
              )}

              <Button
                type="submit"
                disabled={!current || !next || !confirm || change.isPending}
                data-testid="change-password-submit-btn"
                className="active:scale-[0.98]"
              >
                {change.isPending ? "Salvando…" : "Alterar senha"}
              </Button>
            </form>
          </CardContent>
        </Card>
      </div>
    </AppShell>
  );
}
