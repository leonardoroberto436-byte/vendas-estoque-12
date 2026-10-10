import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { KeyRound, MailCheck } from "lucide-react";
import { toast } from "sonner";
import { apiPost } from "@/lib/api";
import { errorMessage } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-100 px-5 py-10">
      <div className="w-full max-w-sm">
        <Card className="animate-rise-in border-slate-200 shadow-sm">
          <CardContent className="p-6">{children}</CardContent>
        </Card>
        <p className="mt-5 text-center text-sm text-slate-500">
          <Link to="/login" className="font-semibold text-teal-700 hover:underline" data-testid="back-to-login-link">
            Voltar para o login
          </Link>
        </p>
      </div>
    </div>
  );
}

/** Step 1 — ask for the email. The answer is always the same, on purpose. */
export function ForgotPassword() {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState<string | null>(null);

  const request = useMutation({
    mutationFn: () => apiPost<{ message: string }>("/auth/forgot-password", { email: email.trim() }),
    onSuccess: (data) => setSent(data.message),
    onError: (err) => toast.error(errorMessage(err, "Não foi possível enviar o e-mail")),
  });

  if (sent) {
    return (
      <Shell>
        <div className="text-center" data-testid="forgot-password-sent">
          <MailCheck className="mx-auto size-10 text-emerald-600" />
          <h1 className="mt-3 text-lg font-bold tracking-tight text-slate-900">Verifique seu e-mail</h1>
          <p className="mt-2 text-sm text-slate-600">{sent}</p>
        </div>
      </Shell>
    );
  }

  return (
    <Shell>
      <h1 className="text-xl font-bold tracking-tight text-slate-900">Esqueci minha senha</h1>
      <p className="mt-1 text-sm text-slate-500">
        Informe seu e-mail e enviamos um link seguro para criar uma nova senha.
      </p>
      <form
        className="mt-6 space-y-4"
        data-testid="forgot-password-form"
        onSubmit={(event) => {
          event.preventDefault();
          if (email.includes("@")) request.mutate();
          else toast.error("Informe um e-mail válido.");
        }}
      >
        <div className="space-y-1.5">
          <Label htmlFor="fp-email">E-mail</Label>
          <Input
            id="fp-email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            data-testid="forgot-password-email-input"
          />
        </div>
        <Button
          type="submit"
          className="w-full active:scale-[0.98]"
          disabled={request.isPending}
          data-testid="forgot-password-submit-button"
        >
          {request.isPending ? "Enviando…" : "Enviar link"}
        </Button>
      </form>
    </Shell>
  );
}

/** Step 2 — consume the single-use token from the emailed link. */
export function ResetPassword() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const token = params.get("token") ?? "";
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState("");

  const reset = useMutation({
    mutationFn: () => apiPost<null>("/auth/reset-password", { token, password }),
    onSuccess: () => {
      toast.success("Senha alterada. Entre com a nova senha.");
      navigate("/login", { replace: true });
    },
    onError: (err) => setError(errorMessage(err, "Não foi possível redefinir a senha")),
  });

  if (!token) {
    return (
      <Shell>
        <div className="text-center" data-testid="reset-password-missing-token">
          <h1 className="text-lg font-bold tracking-tight text-slate-900">Link inválido</h1>
          <p className="mt-2 text-sm text-slate-600">
            Abra o link exatamente como recebeu no e-mail, ou solicite um novo.
          </p>
          <Link
            to="/esqueci-senha"
            className="mt-5 inline-flex rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground"
            data-testid="reset-password-request-new"
          >
            Solicitar novo link
          </Link>
        </div>
      </Shell>
    );
  }

  return (
    <Shell>
      <div className="flex items-center gap-2">
        <KeyRound className="size-5 text-teal-600" />
        <h1 className="text-xl font-bold tracking-tight text-slate-900">Criar nova senha</h1>
      </div>
      <p className="mt-1 text-sm text-slate-500">
        O link é de uso único. Após salvar, todas as sessões antigas são encerradas.
      </p>
      <form
        className="mt-6 space-y-4"
        data-testid="reset-password-form"
        onSubmit={(event) => {
          event.preventDefault();
          setError("");
          if (password.length < 8) return setError("A senha precisa ter pelo menos 8 caracteres.");
          if (password !== confirm) return setError("A confirmação não confere.");
          reset.mutate();
        }}
      >
        <div className="space-y-1.5">
          <Label htmlFor="rp-password">Nova senha</Label>
          <Input
            id="rp-password"
            type="password"
            autoComplete="new-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            data-testid="reset-password-new-input"
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="rp-confirm">Confirmar nova senha</Label>
          <Input
            id="rp-confirm"
            type="password"
            autoComplete="new-password"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            data-testid="reset-password-confirm-input"
          />
        </div>
        {error && (
          <p
            className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm font-medium text-red-700"
            data-testid="reset-password-error"
          >
            {error}
          </p>
        )}
        <Button
          type="submit"
          className="w-full active:scale-[0.98]"
          disabled={reset.isPending}
          data-testid="reset-password-submit-button"
        >
          {reset.isPending ? "Salvando…" : "Salvar nova senha"}
        </Button>
      </form>
    </Shell>
  );
}
