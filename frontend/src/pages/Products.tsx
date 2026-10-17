import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { FileSpreadsheet, Pencil, Plus, Search, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { apiDelete, apiGet, apiPost, apiPut } from "@/lib/api";
import type { Product, ProductCreate } from "@/lib/types";
import {
  STOCK_STATUS_CLASSES,
  STOCK_STATUS_LABELS,
  errorMessage,
  margin,
  money,
  stockStatus,
} from "@/lib/format";
import { useCurrentUser } from "@/lib/useCurrentUser";
import AppShell from "@/components/AppShell";
import ImportProductsDialog from "@/components/ImportProductsDialog";
import ShowMore, { PAGE_SIZE } from "@/components/ShowMore";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
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

interface FormState {
  name: string;
  sku: string;
  category: string;
  cost_price: string;
  sale_price: string;
  current_stock: string;
  min_stock: string;
  barcode: string;
}

const EMPTY: FormState = {
  name: "",
  sku: "",
  category: "",
  cost_price: "",
  sale_price: "",
  current_stock: "0",
  min_stock: "0",
  barcode: "",
};

const num = (value: string) => Number(value.replace(",", ".")) || 0;

export default function Products() {
  const queryClient = useQueryClient();
  // Sellers (OPERADOR) read the catalogue; only the company ADMIN edits it —
  // the backend enforces this, the UI just avoids offering a blocked action.
  const { isAdmin } = useCurrentUser();
  const [search, setSearch] = useState("");
  const [limit, setLimit] = useState(PAGE_SIZE);
  const [form, setForm] = useState<FormState>(EMPTY);
  const [editing, setEditing] = useState<Product | null>(null);
  const [open, setOpen] = useState(false);
  const [deleting, setDeleting] = useState<Product | null>(null);
  const [importing, setImporting] = useState(false);

  const { data, isError } = useQuery({
    queryKey: ["products"],
    queryFn: () => apiGet<Product[]>("/products"),
    refetchOnWindowFocus: false,
  });
  const products = isError ? [] : (data ?? []);

  const term = search.trim().toLowerCase();
  const visible = products.filter(
    (p) =>
      !term ||
      p.name.toLowerCase().includes(term) ||
      p.sku.toLowerCase().includes(term) ||
      (p.barcode ?? "").includes(term),
  );

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ["products"] });
    void queryClient.invalidateQueries({ queryKey: ["dashboard-stats"] });
    void queryClient.invalidateQueries({ queryKey: ["movements"] });
  };

  const save = useMutation({
    mutationFn: async () => {
      const payload: ProductCreate = {
        name: form.name.trim(),
        sku: form.sku.trim(),
        category: form.category.trim(),
        cost_price: num(form.cost_price),
        sale_price: num(form.sale_price),
        current_stock: Math.max(0, Math.trunc(num(form.current_stock))),
        min_stock: Math.max(0, Math.trunc(num(form.min_stock))),
        barcode: form.barcode.replace(/\s+/g, ""),
      };
      if (editing) {
        const { current_stock: _ignored, ...update } = payload;
        return apiPut<Product>(`/products/${editing.id}`, update);
      }
      return apiPost<Product>("/products", payload);
    },
    onSuccess: () => {
      toast.success(editing ? "Produto atualizado" : "Produto cadastrado");
      setOpen(false);
      setEditing(null);
      setForm(EMPTY);
      refresh();
    },
    onError: (error) => toast.error(errorMessage(error, "Não foi possível salvar o produto")),
  });

  const remove = useMutation({
    mutationFn: (id: string) => apiDelete<null>(`/products/${id}`),
    onSuccess: () => {
      toast.success("Produto excluído");
      setDeleting(null);
      refresh();
    },
    onError: (error) => toast.error(errorMessage(error, "Não foi possível excluir o produto")),
  });

  const openCreate = () => {
    setEditing(null);
    setForm(EMPTY);
    setOpen(true);
  };

  const openEdit = (product: Product) => {
    setEditing(product);
    setForm({
      name: product.name,
      sku: product.sku,
      category: product.category,
      cost_price: String(product.cost_price),
      sale_price: String(product.sale_price),
      current_stock: String(product.current_stock),
      min_stock: String(product.min_stock),
      barcode: product.barcode ?? "",
    });
    setOpen(true);
  };

  const formMargin = margin({ cost_price: num(form.cost_price), sale_price: num(form.sale_price) });
  const canSubmit = form.name.trim() && form.sku.trim() && form.category.trim() && num(form.sale_price) > 0;

  return (
    <AppShell>
      <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-slate-900">Catálogo de Produtos</h1>
          <p className="mt-1 text-sm font-medium text-slate-500">
            Preços, margem e estoque de cada item cadastrado
          </p>
        </div>
        {isAdmin && (
          <div className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              onClick={() => setImporting(true)}
              data-testid="btn-open-import-products"
              className="active:scale-[0.98]"
            >
              <FileSpreadsheet className="size-4" />
              Importar planilha
            </Button>
            <Button onClick={openCreate} data-testid="btn-open-create-product" className="active:scale-[0.98]">
              <Plus className="size-4" />
              Novo Produto
            </Button>
          </div>
        )}
      </div>

      <div className="relative mb-4 max-w-md">
        <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-400" />
        <Input
          value={search}
          onChange={(event) => {
            setSearch(event.target.value);
            setLimit(PAGE_SIZE);
          }}
          placeholder="Buscar por nome, SKU ou código de barras…"
          className="pl-9"
          data-testid="product-search-input"
        />
      </div>

      <Card className="border-slate-200/90 shadow-xs">
        <CardContent className="p-0">
          <Table data-testid="products-table">
            <TableHeader>
              <TableRow>
                <TableHead>Produto</TableHead>
                <TableHead>Categoria</TableHead>
                <TableHead className="text-right">Custo</TableHead>
                <TableHead className="text-right">Venda</TableHead>
                <TableHead className="text-right">Margem</TableHead>
                <TableHead className="text-right">Estoque</TableHead>
                <TableHead>Situação</TableHead>
                <TableHead className="text-right">Ações</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {visible.slice(0, limit).map((product) => {
                const status = stockStatus(product);
                return (
                  <TableRow key={product.id} data-testid={`product-table-row-${product.id}`}>
                    <TableCell>
                      <p className="font-semibold text-slate-900">{product.name}</p>
                      <p className="font-mono text-[11px] uppercase tracking-wider text-slate-500">
                        {product.sku}
                      </p>
                    </TableCell>
                    <TableCell className="text-slate-600">{product.category}</TableCell>
                    <TableCell className="text-right font-mono tabular-nums">
                      {money(product.cost_price)}
                    </TableCell>
                    <TableCell className="text-right font-mono font-semibold tabular-nums">
                      {money(product.sale_price)}
                    </TableCell>
                    <TableCell className="text-right font-mono tabular-nums text-slate-600">
                      {margin(product).toFixed(1)}%
                    </TableCell>
                    <TableCell className="text-right font-mono font-semibold tabular-nums">
                      {product.current_stock}
                      <span className="ml-1 text-xs font-normal text-slate-400">
                        / mín {product.min_stock}
                      </span>
                    </TableCell>
                    <TableCell>
                      <span
                        className={`inline-flex items-center rounded-md border px-2 py-1 text-xs font-medium ${STOCK_STATUS_CLASSES[status]}`}
                        data-testid={`product-status-${product.id}`}
                      >
                        {STOCK_STATUS_LABELS[status]}
                      </span>
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-1">
                        {!isAdmin && (
                          <span className="text-xs font-medium text-slate-400">somente leitura</span>
                        )}
                        {isAdmin && (
                        <>
                        <Button
                          size="icon-sm"
                          variant="outline"
                          aria-label={`Editar ${product.name}`}
                          data-testid={`product-edit-btn-${product.id}`}
                          onClick={() => openEdit(product)}
                        >
                          <Pencil className="size-3.5" />
                        </Button>
                        <Button
                          size="icon-sm"
                          variant="ghost"
                          aria-label={`Excluir ${product.name}`}
                          data-testid={`product-delete-btn-${product.id}`}
                          onClick={() => setDeleting(product)}
                        >
                          <Trash2 className="size-3.5 text-red-600" />
                        </Button>
                        </>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })}
              {visible.length === 0 && (
                <TableRow>
                  <TableCell colSpan={8} className="py-10 text-center text-sm text-slate-500">
                    Nenhum produto cadastrado ainda.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
          <ShowMore shown={Math.min(limit, visible.length)} total={visible.length} onMore={() => setLimit(limit + PAGE_SIZE)} />
        </CardContent>
      </Card>

      <ImportProductsDialog open={importing} onOpenChange={setImporting} onImported={refresh} />

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-lg" data-testid="product-modal">
          <DialogHeader>
            <DialogTitle>{editing ? "Editar produto" : "Novo produto"}</DialogTitle>
            <DialogDescription>
              {editing
                ? "O estoque atual é alterado por movimentações, não por aqui."
                : "Informe o estoque inicial — ele entra como movimentação de entrada."}
            </DialogDescription>
          </DialogHeader>

          <div className="grid grid-cols-2 gap-4">
            <div className="col-span-2 space-y-1.5">
              <Label htmlFor="p-name">Nome</Label>
              <Input
                id="p-name"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                data-testid="product-modal-name-input"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="p-sku">SKU</Label>
              <Input
                id="p-sku"
                value={form.sku}
                onChange={(e) => setForm({ ...form, sku: e.target.value })}
                data-testid="product-modal-sku-input"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="p-category">Categoria</Label>
              <Input
                id="p-category"
                value={form.category}
                onChange={(e) => setForm({ ...form, category: e.target.value })}
                data-testid="product-modal-category-input"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="p-cost">Preço de custo (R$)</Label>
              <Input
                id="p-cost"
                inputMode="decimal"
                value={form.cost_price}
                onChange={(e) => setForm({ ...form, cost_price: e.target.value })}
                data-testid="product-modal-cost-price-input"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="p-price">Preço de venda (R$)</Label>
              <Input
                id="p-price"
                inputMode="decimal"
                value={form.sale_price}
                onChange={(e) => setForm({ ...form, sale_price: e.target.value })}
                data-testid="product-modal-sale-price-input"
              />
            </div>
            {!editing && (
              <div className="space-y-1.5">
                <Label htmlFor="p-stock">Estoque inicial</Label>
                <Input
                  id="p-stock"
                  inputMode="numeric"
                  value={form.current_stock}
                  onChange={(e) => setForm({ ...form, current_stock: e.target.value })}
                  data-testid="product-modal-current-stock-input"
                />
              </div>
            )}
            <div className="space-y-1.5">
              <Label htmlFor="p-min">Estoque mínimo</Label>
              <Input
                id="p-min"
                inputMode="numeric"
                value={form.min_stock}
                onChange={(e) => setForm({ ...form, min_stock: e.target.value })}
                data-testid="product-modal-min-stock-input"
              />
            </div>
            <div className="col-span-2 space-y-1.5">
              <Label htmlFor="p-barcode">Código de barras (opcional)</Label>
              <Input
                id="p-barcode"
                inputMode="numeric"
                value={form.barcode}
                placeholder="Clique aqui e passe o leitor na etiqueta"
                onChange={(e) => setForm({ ...form, barcode: e.target.value })}
                // o leitor "aperta Enter" no fim da leitura — aqui isso não deve fazer nada
                onKeyDown={(e) => {
                  if (e.key === "Enter") e.preventDefault();
                }}
                data-testid="product-modal-barcode-input"
              />
            </div>
            <p className="col-span-2 rounded-lg bg-slate-50 px-3 py-2 text-sm text-slate-600">
              Margem de lucro:{" "}
              <strong className="font-mono tabular-nums" data-testid="product-modal-margin">
                {formMargin.toFixed(1)}%
              </strong>
            </p>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)} data-testid="product-modal-cancel-btn">
              Cancelar
            </Button>
            <Button
              onClick={() => save.mutate()}
              disabled={!canSubmit || save.isPending}
              data-testid="product-modal-submit-btn"
            >
              {save.isPending ? "Salvando…" : "Salvar"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={deleting !== null} onOpenChange={(value) => !value && setDeleting(null)}>
        <DialogContent data-testid="product-delete-modal">
          <DialogHeader>
            <DialogTitle>Excluir produto</DialogTitle>
            <DialogDescription>
              {deleting ? `“${deleting.name}” será removido do catálogo.` : ""}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleting(null)} data-testid="product-delete-cancel-btn">
              Cancelar
            </Button>
            <Button
              variant="destructive"
              onClick={() => deleting && remove.mutate(deleting.id)}
              disabled={remove.isPending}
              data-testid="product-delete-confirm-btn"
            >
              {remove.isPending ? "Excluindo…" : "Excluir"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AppShell>
  );
}
