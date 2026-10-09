import { useQuery } from "@tanstack/react-query";
import { ApiError, apiGet } from "@/lib/api";
import type { User } from "@/lib/types";

/** Who am I — answered by the backend from the httpOnly session cookie. */
export function useCurrentUser() {
  const query = useQuery({
    queryKey: ["auth-me"],
    queryFn: () => apiGet<User>("/auth/me"),
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
    blockedMessage:
      query.error instanceof ApiError && query.error.status === 403
        ? "Seu acesso está desativado. Fale com o administrador."
        : null,
  };
}
