import { useRef, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Download, FileSpreadsheet, Upload } from "lucide-react";
import { toast } from "sonner";
import { apiUpload } from "@/lib/api";
import { errorMessage } from "@/lib/format";
import type { ImportAction, ImportResult } from "@/lib/types";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

const ACTION_LABEL: Record<ImportAction, string> = {
  CRIAR: "Novo",
  ATUALIZAR: "Atualizar",
  SEM_MUDANCA: "Sem mudança",
  ERRO: "Erro",
};

const ACTION_CLASS: Record<ImportAction, string> = {
  CRIAR: "border-teal-200 bg-teal-50 text-teal-800",
  ATUALIZAR: "border-sky-200 bg-sky-50 text-sky-800",
  SEM_MUDANCA: "border-slate-200 bg-slate-50 text-slate-600",
  ERRO: "border-red-200 bg-red-50 text-red-700",
};

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onImported: () => void;
}

export default function ImportProductsDialog({ open, onOpenChange, onImported }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<ImportResult | null>(null);

  const reset = () => {
    setFile(null);
    setPreview(null);
    if (inputRef.current) inputRef.current.value = "";
  };

  const check = useMutation({
    mutationFn: (f: File) => apiUpload<ImportResult>("/products/import?dry_run=true", f),
    onSuccess: setPreview,
    onError: (error) => {
      setPreview(null);
      toast.error(errorMessage(error, "Não foi possível ler a planilha"));
    },
  });

  const apply = useMutation({
    mutationFn: (f: File) => apiUpload<ImportResult>("/products/import?dry_run=false", f),
    onSuccess: (result) => {
      toast.success(result.message);
      onImported();
      reset();
      onOpenChange(false);
    },
    onError: (error) => toast.error(errorMessage(error, "Não foi possível importar")),
  });

  const pick = (f: File | undefined) => {
    if (!f) return;
    setFile(f);
    setPreview(null);
    check.mutate(f);
  };

  const toApply = preview ? preview.created + preview.updated : 0;

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) reset();
        onOpenChange(next);
      }}
    >
      <DialogContent className="max-w-2xl" data-testid="import-modal">
        <DialogHeader>
          <DialogTitle>Importar produtos por planilha</DialogTitle>
          <DialogDescription>
            Use o nosso modelo ou a planilha que você já tem (Excel .xlsx ou .csv). O SKU é a chave:
            SKU novo cria o produto, SKU que já existe é atualizado.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="flex flex-wrap gap-2">
            <a
              href="/api/products/import/template.xlsx"
              className="inline-flex items-center gap-2 rounded-lg border border-input bg-white px-3 py-2 text-sm font-semibold text-slate-800 shadow-xs hover:bg-slate-50"
              data-testid="import-template-btn"
            >
              <Download className="size-4" />
              Baixar modelo
            </a>
            <Button
              type="button"
              variant="outline"
              onClick={() => inputRef.current?.click()}
              disabled={check.isPending || apply.isPending}
              data-testid="import-pick-btn"
            >
              <Upload className="size-4" />
              {file ? "Trocar arquivo" : "Escolher planilha"}
            </Button>
            <input
              ref={inputRef}
              type="file"
              accept=".xlsx,.csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv"
              className="hidden"
              onChange={(e) => pick(e.target.files?.[0])}
              data-testid="import-file-input"
            />
          </div>

          {file && (
            <p className="flex items-center gap-2 text-sm text-slate-600">
              <FileSpreadsheet className="size-4 text-teal-700" />
              {file.name}
              {check.isPending && <span className="text-slate-400">— lendo…</span>}
            </p>
          )}

          {preview && (
            <div className="space-y-3" data-testid="import-preview">
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                {(
                  [
                    ["Novos", preview.created, "text-teal-700"],
                    ["Atualizados", preview.updated, "text-sky-700"],
                    ["Sem mudança", preview.unchanged, "text-slate-600"],
                    ["Com erro", preview.errors, "text-red-700"],
                  ] as const
                ).map(([label, value, color]) => (
                  <div key={label} className="rounded-lg border border-slate-200 px-3 py-2">
                    <p className="text-xs font-medium text-slate-500">{label}</p>
                    <p className={`font-mono text-xl font-bold tabular-nums ${color}`}>{value}</p>
                  </div>
                ))}
              </div>

              {preview.blocked && (
                <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
                  {preview.blocked}
                </p>
              )}
              {preview.errors > 0 && !preview.blocked && (
                <p className="text-sm text-slate-600">
                  As linhas com erro serão ignoradas — corrija na planilha e importe de novo se quiser.
                </p>
              )}

              <div className="max-h-64 overflow-auto rounded-lg border border-slate-200">
                <table className="w-full text-sm">
                  <thead className="sticky top-0 bg-slate-50 text-left text-xs text-slate-500">
                    <tr>
                      <th className="px-3 py-2 font-medium">Linha</th>
                      <th className="px-3 py-2 font-medium">SKU</th>
                      <th className="px-3 py-2 font-medium">Produto</th>
                      <th className="px-3 py-2 font-medium">Resultado</th>
                    </tr>
                  </thead>
                  <tbody>
                    {preview.rows.map((r) => (
                      <tr key={r.row} className="border-t border-slate-100">
                        <td className="px-3 py-1.5 font-mono text-xs text-slate-500">{r.row}</td>
                        <td className="px-3 py-1.5 font-mono text-xs">{r.sku}</td>
                        <td className="px-3 py-1.5">{r.name}</td>
                        <td className="px-3 py-1.5">
                          <span
                            className={`inline-flex rounded-md border px-2 py-0.5 text-xs font-medium ${ACTION_CLASS[r.action]}`}
                          >
                            {ACTION_LABEL[r.action]}
                          </span>
                          {r.message && <span className="ml-2 text-xs text-red-700">{r.message}</span>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {preview.total_rows > preview.rows.length && (
                <p className="text-xs text-slate-500">
                  Mostrando as primeiras {preview.rows.length} de {preview.total_rows} linhas.
                </p>
              )}
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button
            onClick={() => file && apply.mutate(file)}
            disabled={!file || !preview || !!preview.blocked || toApply === 0 || apply.isPending}
            data-testid="import-confirm-btn"
          >
            {apply.isPending ? "Importando…" : `Importar ${toApply} produto${toApply === 1 ? "" : "s"}`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
