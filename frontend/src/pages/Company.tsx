import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Building2, Download, ImageUp, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { apiGet, apiPut } from "@/lib/api";
import type { OrgBranding } from "@/lib/types";
import { errorMessage } from "@/lib/format";
import { useCurrentUser } from "@/lib/useCurrentUser";
import AppShell from "@/components/AppShell";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const MAX_LOGO_BYTES = 300 * 1024;
const EMPTY: OrgBranding = { trade_name: "", cnpj: "", phone: "", address: "", logo: null };

export default function Company() {
  const queryClient = useQueryClient();
  const { user } = useCurrentUser();
  const fileRef = useRef<HTMLInputElement>(null);
  const [form, setForm] = useState<OrgBranding>(EMPTY);
  const loaded = useRef(false);

  const { data } = useQuery({
    queryKey: ["branding"],
    queryFn: () => apiGet<OrgBranding>("/settings/branding"),
    refetchOnWindowFocus: false,
  });

  // Fill the form once, when the saved branding first arrives — re-filling on
  // every refetch would wipe out what the user is typing.
  useEffect(() => {
    if (data && !loaded.current) {
      loaded.current = true;
      setForm(data);
    }
  }, [data]);

  const save = useMutation({
    mutationFn: () => apiPut<OrgBranding>("/settings/branding", { ...form }),
    onSuccess: (result) => {
      setForm(result);
      toast.success("Dados da empresa salvos — já aparecem no cupom e no relatório");
      void queryClient.invalidateQueries({ queryKey: ["branding"] });
    },
    onError: (error) => toast.error(errorMessage(error, "Não foi possível salvar")),
  });

  const pickLogo = (file: File) => {
    if (!["image/png", "image/jpeg"].includes(file.type)) {
      toast.error("Envie uma imagem PNG ou JPG");
      return;
    }
    if (file.size > MAX_LOGO_BYTES) {
      toast.error("O logo deve ter no máximo 300 KB");
      return;
    }
    const reader = new FileReader();
    reader.onload = () => setForm((prev) => ({ ...prev, logo: String(reader.result) }));
    reader.readAsDataURL(file);
  };

  return (
    <AppShell>
      <div className="mb-6">
        <h1 className="text-3xl font-bold tracking-tight text-slate-900">Minha Empresa</h1>
        <p className="mt-1 text-sm text-slate-500">
          Logo e dados que aparecem no cupom do balcão (impressão e WhatsApp) e no relatório mensal.
        </p>
      </div>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
        <Card className="border-slate-200/90 shadow-xs">
          <CardHeader>
            <CardTitle className="text-base font-bold tracking-tight">Identificação</CardTitle>
          </CardHeader>
          <CardContent>
            <form
              className="grid gap-4"
              onSubmit={(event) => {
                event.preventDefault();
                save.mutate();
              }}
            >
              <div className="grid gap-2">
                <Label htmlFor="trade-name">Nome fantasia</Label>
                <Input
                  id="trade-name"
                  data-testid="company-trade-name-input"
                  placeholder={user?.organization?.name ?? "Minha Loja"}
                  value={form.trade_name}
                  onChange={(e) => setForm({ ...form, trade_name: e.target.value })}
                />
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="grid gap-2">
                  <Label htmlFor="cnpj">CNPJ</Label>
                  <Input
                    id="cnpj"
                    data-testid="company-cnpj-input"
                    placeholder="00.000.000/0000-00"
                    value={form.cnpj}
                    onChange={(e) => setForm({ ...form, cnpj: e.target.value })}
                  />
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="phone">Telefone</Label>
                  <Input
                    id="phone"
                    data-testid="company-phone-input"
                    placeholder="(11) 98888-7777"
                    value={form.phone}
                    onChange={(e) => setForm({ ...form, phone: e.target.value })}
                  />
                </div>
              </div>
              <div className="grid gap-2">
                <Label htmlFor="address">Endereço</Label>
                <Input
                  id="address"
                  data-testid="company-address-input"
                  placeholder="Rua, número — bairro, cidade"
                  value={form.address}
                  onChange={(e) => setForm({ ...form, address: e.target.value })}
                />
              </div>
              <div>
                <Button type="submit" disabled={save.isPending} data-testid="company-save-button">
                  {save.isPending ? "Salvando..." : "Salvar dados da empresa"}
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>

        <Card className="border-slate-200/90 shadow-xs">
          <CardHeader>
            <CardTitle className="text-base font-bold tracking-tight">Logo</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex h-36 items-center justify-center rounded-xl border border-dashed border-slate-300 bg-slate-50">
              {form.logo ? (
                <img
                  src={form.logo}
                  alt="Logo da empresa"
                  className="max-h-32 max-w-[240px] object-contain"
                  data-testid="company-logo-preview"
                />
              ) : (
                <span className="flex flex-col items-center gap-2 text-xs font-medium text-slate-400">
                  <Building2 className="size-6" />
                  Nenhum logo enviado
                </span>
              )}
            </div>
            <input
              ref={fileRef}
              type="file"
              accept="image/png,image/jpeg"
              className="hidden"
              data-testid="company-logo-file-input"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) pickLogo(file);
                e.target.value = "";
              }}
            />
            <div className="flex gap-2">
              <Button
                type="button"
                variant="outline"
                data-testid="company-logo-pick-button"
                onClick={() => fileRef.current?.click()}
              >
                <ImageUp className="size-4" />
                Escolher imagem
              </Button>
              {form.logo && (
                <Button
                  type="button"
                  variant="ghost"
                  data-testid="company-logo-remove-button"
                  onClick={() => setForm({ ...form, logo: null })}
                >
                  <Trash2 className="size-4" />
                  Remover
                </Button>
              )}
            </div>
            <p className="text-xs text-slate-500">
              PNG ou JPG, até 300 KB. Clique em <strong>Salvar dados da empresa</strong> para
              aplicar.
            </p>
          </CardContent>
        </Card>

        <Card className="border-slate-200/90 shadow-xs lg:col-span-2" data-testid="company-export-card">
          <CardHeader>
            <CardTitle className="text-base font-bold tracking-tight">Cópia dos seus dados</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <p className="max-w-2xl text-sm text-slate-600">
              Baixe uma planilha com todos os produtos, vendas, devoluções e movimentações de
              estoque da sua loja. Os dados também são copiados automaticamente todos os dias,
              mas é bom guardar uma cópia sua de vez em quando.
            </p>
            <a
              href="/api/settings/export.xlsx"
              className="inline-flex shrink-0 items-center gap-2 rounded-lg border border-input bg-white px-4 py-2.5 text-sm font-semibold text-slate-800 shadow-xs transition-colors duration-150 ease-out hover:bg-slate-50 active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-500 focus-visible:ring-offset-2"
              data-testid="company-export-xlsx-btn"
            >
              <Download className="size-4" />
              Baixar planilha
            </a>
          </CardContent>
        </Card>
      </div>
    </AppShell>
  );
}
