import { Navigate, useLocation } from "react-router-dom";
import { ShieldAlert } from "lucide-react";
import { useCurrentUser } from "@/lib/useCurrentUser";

interface Props {
  children: React.ReactNode;
  adminOnly?: boolean;
  platformOnly?: boolean;
}

/** Route guard. The server enforces access; this only keeps the UI honest. */
export default function RequireAuth({
  children,
  adminOnly = false,
  platformOnly = false,
}: Props) {
  const { user, isLoading, unauthenticated, isAdmin, isPlatformOwner } = useCurrentUser();
  const location = useLocation();

  if (isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-100">
        <p className="text-sm font-medium text-slate-500" data-testid="auth-loading">
          Verificando acesso…
        </p>
      </div>
    );
  }

  if (unauthenticated || !user) {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  }

  // The SaaS owner has no shop workspace — send them to their own area.
  if (isPlatformOwner && !platformOnly) {
    return <Navigate to="/plataforma" replace />;
  }

  if (platformOnly && !isPlatformOwner) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-100 px-5">
        <div
          className="max-w-sm rounded-xl border border-red-200 bg-white p-8 text-center shadow-sm"
          data-testid="platform-only-blocked"
        >
          <ShieldAlert className="mx-auto size-8 text-red-600" />
          <h1 className="mt-3 text-lg font-bold tracking-tight text-slate-900">
            Área exclusiva da plataforma
          </h1>
          <p className="mt-1 text-sm text-slate-500">
            Somente o proprietário do SaaS acessa esta página.
          </p>
          <a
            href="/"
            className="mt-5 inline-flex rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground"
            data-testid="platform-only-back-link"
          >
            Voltar ao início
          </a>
        </div>
      </div>
    );
  }

  if (adminOnly && !isAdmin) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-100 px-5">
        <div
          className="max-w-sm rounded-xl border border-amber-200 bg-white p-8 text-center shadow-sm"
          data-testid="admin-only-blocked"
        >
          <ShieldAlert className="mx-auto size-8 text-amber-600" />
          <h1 className="mt-3 text-lg font-bold tracking-tight text-slate-900">
            Área restrita ao administrador
          </h1>
          <p className="mt-1 text-sm text-slate-500">
            Seu perfil é de operador e não pode gerenciar usuários.
          </p>
          <a
            href="/"
            className="mt-5 inline-flex rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground"
            data-testid="admin-only-back-link"
          >
            Voltar ao início
          </a>
        </div>
      </div>
    );
  }

  return <>{children}</>;
}
