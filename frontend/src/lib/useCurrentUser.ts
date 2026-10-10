import { useQuery } from "@tanstack/react-query";
import { ApiError, apiGet } from "@/lib/api";
import type { SessionUser } from "@/lib/types";
import { errorMessage } from "@/lib/format";

/** Who am I — answered by the backend from the httpOnly session cookie. */
export function useCurrentUser() {
  const query = useQuery({
    queryKey: ["auth-me"],
    queryFn: () => apiGet<SessionUser>("/auth/me"),
    retry: (count, error) => {
      if (error instanceof ApiError && (error.status === 401 || error.status === 403)) return false;
      return count < 1;
    },
    refetchOnWindowFocus: false,
    staleTime: 30_000,
  });

  const unauthenticated =
    query.isError && query.error instanceof ApiError
      ? query.error.status === 401 || query.error.status === 403
      : false;

  return {
    user: query.data,
    isLoading: query.isLoading,
    unauthenticated,
    isAdmin: query.data?.role === "ADMIN",
    isPlatformOwner: query.data?.role === "PLATFORM_OWNER",
    organization: query.data?.organization ?? null,
    blockedMessage:
      query.error instanceof ApiError && query.error.status === 403
        ? // o servidor explica o motivo (teste encerrado, empresa suspensa, acesso desativado...)
          errorMessage(query.error, "Seu acesso está desativado. Fale com o administrador.")
        : null,
  };
}
