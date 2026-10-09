import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { KeyRound, ShieldCheck, Trash2, UserPlus } from "lucide-react";
import { toast } from "sonner";
import { apiDelete, apiGet, apiPost, apiPut } from "@/lib/api";
import type { CompanyRole, User, UserCreate } from "@/lib/types";
import { errorMessage, formatDateTime } from "@/lib/format";
import { useCurrentUser } from "@/lib/useCurrentUser";
import AppShell from "@/components/AppShell";
import AccessLogTable from "@/components/AccessLogTable";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

const ROLE_LABELS: Record<CompanyRole, string> = {
  ADMIN: "Administrador",
  OPERADOR: "Operador",
};

const EMPTY = {
  name: "",
  email: "",
  password: "",
  role: "OPERADOR" as CompanyRole,
  is_active: true,
};

export default function Admin() {
  const queryClient = useQueryClient();
  const { user: me } = useCurrentUser();
  const [createOpen, setCreateOpen] = useState(false);
  const [form, setForm] = useState(EMPTY);
  const [resetting, setResetting] = useState<User | null>(null);
  const [newPassword, setNewPassword] = useState("");
  const [deleting, setDeleting] = useState<User | null>(null);

  const { data, isError } = useQuery({
    queryKey: ["users"],
    queryFn: () => apiGet<User[]>("/users"),
    refetchOnWindowFocus: false,
  });
  const users = isError ? [] : (data ?? []);

  const refresh = () => void queryClient.invalidateQueries({ queryKey: ["users"] });

  const create = useMutation({
    mutationFn: () => {
      const payload: UserCreate = {
        name: form.name.trim(),
        email: form.email.trim().toLowerCase(),
        password: form.password,
        role: form.role,
        is_active: form.is_active,
      };
      return apiPost<User>("/users", payload);
    },
    onSuccess: (user) => {
      toast.success(`Acesso liberado para ${user.name}`);
      setCreateOpen(false);
      setForm(EMPTY);
      refresh();
    },
    onError: (error) => toast.error(errorMessage(error, "Não foi possível criar o usuário")),
  });

  const update = useMutation({
    mutationFn: ({ id, changes }: { id: string; changes: Record<string, unknown> }) =>
      apiPut<User>(`/users/${id}`, changes),
    onSuccess: () => {
      toast.success("Usuário atualizado");
      refresh();
    },
    onError: (error) => toast.error(errorMessage(error, "Não foi possível atualizar o usuário")),
  });

  const resetPassword = useMutation({
    mutationFn: ({ id, password }: { id: string; password: string }) =>
      apiPut<null>(`/users/${id}/password`, { password }),
    onSuccess: () => {
      toast.success("Senha redefinida — o usuário precisará entrar novamente");
      setResetting(null);
      setNewPassword("");
      refresh();
    },
    onError: (error) => toast.error(errorMessage(error, "Não foi possível redefinir a senha")),
  });

  const remove = useMutation({
    mutationFn: (id: string) => apiDelete<null>(`/users/${id}`),
    onSuccess: () => {
      toast.success("Usuário excluído");
      setDeleting(null);
      refresh();
    },
    onError: (error) => toast.error(errorMessage(error, "Não foi possível excluir o usuário")),
  });

  const canSubmit =
    form.name.trim().length >= 2 && form.email.includes("@") && form.password.length >= 8;

  return (
    <AppShell>
      <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-slate-900">
            Painel Administrativo
          </h1>
          <p className="mt-1 text-sm font-medium text-slate-500">
            Só você libera acesso: crie contas, ative/desative, troque o perfil e redefina senhas
          </p>
        </div>
        <Button onClick={() => setCreateOpen(true)} data-testid="btn-open-create-user" className="active:scale-[0.98]">
          <UserPlus className="size-4" />
          Liberar Novo Acesso
        </Button>
      </div>

      <Card className="mb-6 border-teal-200 bg-teal-50/50 shadow-xs">
        <CardContent className="flex items-start gap-3 p-5">
          <ShieldCheck className="mt-0.5 size-5 shrink-0 text-teal-700" />
          <p className="text-sm text-teal-900">
            <strong>Administrador</strong> faz tudo, incluindo gerenciar usuários.{" "}
            <strong>Operador</strong> usa o sistema inteiro (vendas, estoque, produtos, relatórios)
            mas não acessa esta tela. Desativar um acesso encerra a sessão do usuário na hora.
          </p>
        </CardContent>
      </Card>

      <Card className="border-slate-200/90 shadow-xs">
        <CardContent className="p-0">
          <Table data-testid="users-table">
            <TableHeader>
              <TableRow>
                <TableHead>Usuário</TableHead>
                <TableHead>Perfil</TableHead>
                <TableHead>Acesso liberado</TableHead>
                <TableHead>Último login</TableHead>
                <TableHead className="text-right">Ações</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {users.map((user) => {
                const isMe = user.id === me?.id;
                return (
                  <TableRow key={user.id} data-testid={`user-table-row-${user.id}`}>
                    <TableCell>
                      <p className="font-semibold text-slate-900">
                        {user.name}
                        {isMe && (
                          <span className="ml-2 rounded bg-slate-900 px-1.5 py-0.5 text-[10px] font-bold uppercase text-white">
                            você
                          </span>
                        )}
                      </p>
                      <p className="text-xs text-slate-500">{user.email}</p>
                    </TableCell>
                    <TableCell>
                      <Select
                        value={user.role}
                        onValueChange={(value: string) =>
                          update.mutate({ id: user.id, changes: { role: value } })
                        }
                      >
                        <SelectTrigger size="sm" className="w-40" data-testid={`user-role-select-${user.id}`}>
                          <SelectValue>{(value) => ROLE_LABELS[value as CompanyRole]}</SelectValue>
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="ADMIN">Administrador</SelectItem>
                          <SelectItem value="OPERADOR">Operador</SelectItem>
                        </SelectContent>
                      </Select>
                    </TableCell>
                    <TableCell>
                      <label className="flex items-center gap-2 text-sm">
                        <Checkbox
                          checked={user.is_active}
                          onCheckedChange={(checked) =>
                            update.mutate({ id: user.id, changes: { is_active: checked === true } })
                          }
                          aria-label={`Liberar acesso de ${user.name}`}
                          data-testid={`user-active-toggle-${user.id}`}
                        />
                        <span
                          className={
                            user.is_active ? "font-medium text-emerald-700" : "text-slate-500"
                          }
                          data-testid={`user-status-label-${user.id}`}
                        >
                          {user.is_active ? "Liberado" : "Bloqueado"}
                        </span>
                      </label>
                    </TableCell>
                    <TableCell className="font-mono text-xs tabular-nums text-slate-500">
                      {user.last_login_at ? formatDateTime(user.last_login_at) : "nunca entrou"}
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-1">
                        <Button
                          size="icon-sm"
                          variant="outline"
                          aria-label={`Redefinir senha de ${user.name}`}
                          data-testid={`user-reset-password-btn-${user.id}`}
                          onClick={() => {
                            setResetting(user);
                            setNewPassword("");
                          }}
                        >
                          <KeyRound className="size-3.5" />
                        </Button>
                        <Button
                          size="icon-sm"
                          variant="ghost"
                          aria-label={`Excluir ${user.name}`}
                          data-testid={`user-delete-btn-${user.id}`}
                          disabled={isMe}
                          onClick={() => setDeleting(user)}
                        >
                          <Trash2 className="size-3.5 text-red-600" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })}
              {users.length === 0 && (
                <TableRow>
                  <TableCell colSpan={5} className="py-10 text-center text-sm text-slate-500">
                    Nenhum usuário cadastrado.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <AccessLogTable />

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent data-testid="user-create-modal">          <DialogHeader>
            <DialogTitle>Liberar novo acesso</DialogTitle>
            <DialogDescription>
              A conta já entra liberada (ou crie bloqueada e libere depois).
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="u-name">Nome</Label>
              <Input
                id="u-name"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                data-testid="user-modal-name-input"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="u-email">E-mail</Label>
              <Input
                id="u-email"
                type="email"
                value={form.email}
                onChange={(e) => setForm({ ...form, email: e.target.value })}
                data-testid="user-modal-email-input"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="u-password">Senha provisória (mín. 8 caracteres)</Label>
              <Input
                id="u-password"
                type="text"
                value={form.password}
                onChange={(e) => setForm({ ...form, password: e.target.value })}
                data-testid="user-modal-password-input"
              />
            </div>
            <div className="space-y-1.5">
              <Label>Perfil</Label>
              <Select
                value={form.role}
                onValueChange={(value: string) => setForm({ ...form, role: value as CompanyRole })}
              >
                <SelectTrigger data-testid="user-modal-role-select">
                  <SelectValue>{(value) => ROLE_LABELS[value as CompanyRole]}</SelectValue>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="OPERADOR">Operador</SelectItem>
                  <SelectItem value="ADMIN">Administrador</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <label className="flex items-center gap-2 text-sm text-slate-700">
              <Checkbox
                checked={form.is_active}
                onCheckedChange={(checked) => setForm({ ...form, is_active: checked === true })}
                data-testid="user-modal-active-checkbox"
              />
              Já liberar o acesso agora
            </label>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)} data-testid="user-modal-cancel-btn">
              Cancelar
            </Button>
            <Button
              onClick={() => create.mutate()}
              disabled={!canSubmit || create.isPending}
              data-testid="user-modal-submit-btn"
            >
              {create.isPending ? "Criando…" : "Liberar acesso"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={resetting !== null} onOpenChange={(open) => !open && setResetting(null)}>
        <DialogContent data-testid="user-reset-password-modal">
          <DialogHeader>
            <DialogTitle>Redefinir senha</DialogTitle>
            <DialogDescription>
              {resetting
                ? `Defina uma nova senha para ${resetting.name}. A sessão atual dele será encerrada.`
                : ""}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5">
            <Label htmlFor="u-newpass">Nova senha (mín. 8 caracteres)</Label>
            <Input
              id="u-newpass"
              type="text"
              value={newPassword}
              onChange={(event) => setNewPassword(event.target.value)}
              data-testid="user-reset-password-input"
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setResetting(null)} data-testid="user-reset-cancel-btn">
              Cancelar
            </Button>
            <Button
              onClick={() =>
                resetting && resetPassword.mutate({ id: resetting.id, password: newPassword })
              }
              disabled={newPassword.length < 8 || resetPassword.isPending}
              data-testid="user-reset-confirm-btn"
            >
              {resetPassword.isPending ? "Salvando…" : "Redefinir"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={deleting !== null} onOpenChange={(open) => !open && setDeleting(null)}>
        <DialogContent data-testid="user-delete-modal">
          <DialogHeader>
            <DialogTitle>Excluir usuário</DialogTitle>
            <DialogDescription>
              {deleting ? `“${deleting.name}” perderá o acesso imediatamente.` : ""}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleting(null)} data-testid="user-delete-cancel-btn">
              Cancelar
            </Button>
            <Button
              variant="destructive"
              onClick={() => deleting && remove.mutate(deleting.id)}
              disabled={remove.isPending}
              data-testid="user-delete-confirm-btn"
            >
              {remove.isPending ? "Excluindo…" : "Excluir"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AppShell>
  );
}
