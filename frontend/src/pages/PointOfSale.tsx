import { useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Minus, MessageCircle, Plus, Printer, Search, ShoppingCart, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { apiGet, apiPost } from "@/lib/api";
import type { OrgBranding, PaymentMethod, Product, Sale, SaleCreate } from "@/lib/types";
import {
  PAYMENT_LABELS,
  errorMessage,
  formatDateTime,
  money,
  printReceipt,
  receiptText,
  stockStatus,
  whatsappLink,
} from "@/lib/format";
import { useCurrentUser } from "@/lib/useCurrentUser";
import AppShell from "@/components/AppShell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { BRAND_NAME } from "@/lib/brand";

const PAYMENTS: PaymentMethod[] = ["DINHEIRO", "PIX", "CARTAO_DEBITO", "CARTAO_CREDITO"];

export default function PointOfSale() {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const searchRef = useRef<HTMLInputElement>(null);
  const [category, setCategory] = useState("TODAS");
  const [cart, setCart] = useState<Record<string, number>>({});
  const [payment, setPayment] = useState<PaymentMethod>("DINHEIRO");
  const [discount, setDiscount] = useState("0");
  const [receipt, setReceipt] = useState<Sale | null>(null);
  const [phone, setPhone] = useState("");
  const { user } = useCurrentUser();
  const company = user?.organization?.name ?? BRAND_NAME;
  const { data: branding } = useQuery({
    queryKey: ["branding"],
    queryFn: () => apiGet<OrgBranding>("/settings/branding"),
    refetchOnWindowFocus: false,
  });
  const headerName = branding?.trade_name?.trim() || company;

  const { data: products, isError } = useQuery({
    queryKey: ["products"],
    queryFn: () => apiGet<Product[]>("/products"),
    refetchOnWindowFocus: false,
  });

  // `products` é a referência estável vinda do cache; derivar a lista dentro do
  // useMemo evita recriar o array (e re-executar o memo) em todo render.
  const list = useMemo(() => (isError ? [] : (products ?? [])), [isError, products]);
  const categories = useMemo(
    () => ["TODAS", ...Array.from(new Set(list.map((p) => p.category))).sort()],
    [list],
  );

  const visible = list.filter((product) => {
    const term = search.trim().toLowerCase();
    const matchesTerm =
      !term ||
      product.name.toLowerCase().includes(term) ||
      product.sku.toLowerCase().includes(term) ||
      (product.barcode ?? "").includes(term);
    const matchesCategory = category === "TODAS" || product.category === category;
    return matchesTerm && matchesCategory;
  });

  const cartLines = Object.entries(cart)
    .map(([productId, quantity]) => {
      const product = list.find((p) => p.id === productId);
      return product ? { product, quantity } : null;
    })
    .filter((line): line is { product: Product; quantity: number } => line !== null);

  const subtotal = cartLines.reduce((sum, l) => sum + l.product.sale_price * l.quantity, 0);
  const discountValue = Math.min(Math.max(Number(discount.replace(",", ".")) || 0, 0), subtotal);
  const total = subtotal - discountValue;

  const addToCart = (product: Product) => {
    const current = cart[product.id] ?? 0;
    if (current + 1 > product.current_stock) {
      toast.error(`Estoque insuficiente: ${product.name} tem ${product.current_stock} un.`);
      return;
    }
    setCart({ ...cart, [product.id]: current + 1 });
  };

  // Leitor de código de barras (USB/Bluetooth) funciona como um teclado: digita o
  // código no campo de busca e aperta Enter. No Enter procuramos o produto pelo
  // código de barras ou SKU exato; se não houver, e a busca mostrar um só produto,
  // ele entra no carrinho. O campo é limpo e continua focado para a próxima leitura.
  const handleScan = () => {
    const code = search.replace(/\s+/g, "");
    if (!code) return;
    const upper = code.toUpperCase();
    const exact =
      list.find((p) => p.barcode && p.barcode === code) ??
      list.find((p) => p.sku.toUpperCase() === upper);
    const product = exact ?? (visible.length === 1 ? visible[0] : undefined);
    if (!product) {
      toast.error(`Nenhum produto com o código ${code}`);
      searchRef.current?.select();
      return;
    }
    addToCart(product);
    setSearch("");
    searchRef.current?.focus();
  };

  const decrement = (productId: string) => {
    const current = cart[productId] ?? 0;
    const next = { ...cart };
    if (current <= 1) delete next[productId];
    else next[productId] = current - 1;
    setCart(next);
  };

  const removeLine = (productId: string) => {
    const next = { ...cart };
    delete next[productId];
    setCart(next);
  };

  const finalize = useMutation({
    mutationFn: (payload: SaleCreate) => apiPost<Sale>("/sales", payload),
    onSuccess: (sale) => {
      setCart({});
      setDiscount("0");
      setReceipt(sale);
      setPhone("");
      toast.success(`Venda realizada: ${money(sale.total)}`);
      void queryClient.invalidateQueries({ queryKey: ["products"] });
      void queryClient.invalidateQueries({ queryKey: ["sales"] });
      void queryClient.invalidateQueries({ queryKey: ["dashboard-stats"] });
      void queryClient.invalidateQueries({ queryKey: ["movements"] });
    },
    onError: (error) => toast.error(errorMessage(error, "Não foi possível finalizar a venda")),
  });

  return (
    <AppShell>
      <div className="mb-6">
        <h1 className="text-3xl font-bold tracking-tight text-slate-900">Venda Balcão</h1>
        <p className="mt-1 text-sm font-medium text-slate-500">
          Selecione os produtos, confira o carrinho e finalize — o estoque baixa automaticamente
        </p>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
        <div className="lg:col-span-7 xl:col-span-8">
          <div className="mb-4 flex flex-col gap-3 sm:flex-row">
            <div className="relative flex-1">
              <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-400" />
              <Input
                ref={searchRef}
                autoFocus
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    handleScan();
                  }
                }}
                placeholder="Buscar ou passar o leitor de código de barras…"
                className="pl-9"
                data-testid="pos-search-input"
              />
            </div>
            <Select value={category} onValueChange={(value: string) => setCategory(value)}>
              <SelectTrigger className="sm:w-56" data-testid="pos-category-filter">
                <SelectValue>
                  {(value) => (value === "TODAS" ? "Todas as categorias" : String(value))}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                {categories.map((item) => (
                  <SelectItem key={item} value={item}>
                    {item === "TODAS" ? "Todas as categorias" : item}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {visible.map((product) => {
              const status = stockStatus(product);
              const inCart = cart[product.id] ?? 0;
              return (
                <Card
                  key={product.id}
                  data-testid={`pos-product-card-${product.id}`}
                  className={`border-slate-200/90 shadow-xs transition-shadow duration-150 ease-out hover:border-slate-300 hover:shadow-sm ${
                    inCart > 0 ? "border-teal-500 ring-1 ring-teal-500/20" : ""
                  }`}
                >
                  <CardContent className="flex h-full flex-col gap-3 p-4">
                    <div>
                      <p className="line-clamp-2 text-sm font-semibold leading-snug text-slate-900">
                        {product.name}
                      </p>
                      <p className="mt-1 inline-block rounded bg-slate-100 px-2 py-0.5 font-mono text-[11px] uppercase tracking-wider text-slate-600">
                        {product.sku}
                      </p>
                    </div>
                    <div className="mt-auto flex items-end justify-between gap-2">
                      <div>
                        <p className="font-mono text-lg font-semibold tabular-nums text-slate-900">
                          {money(product.sale_price)}
                        </p>
                        <p
                          className={`text-xs font-medium ${
                            status === "ESGOTADO"
                              ? "text-red-600"
                              : status === "BAIXO"
                                ? "text-amber-700"
                                : "text-slate-500"
                          }`}
                        >
                          {product.current_stock} em estoque
                        </p>
                      </div>
                      <Button
                        size="sm"
                        onClick={() => addToCart(product)}
                        disabled={product.current_stock === 0 || inCart >= product.current_stock}
                        aria-label={`Adicionar ${product.name} ao carrinho`}
                        data-testid={`pos-add-btn-${product.id}`}
                        className="active:scale-[0.98]"
                      >
                        <Plus className="size-4" />
                        {inCart > 0 ? inCart : "Add"}
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              );
            })}
            {visible.length === 0 && (
              <p className="col-span-full rounded-lg border border-dashed border-slate-300 p-8 text-center text-sm text-slate-500">
                Nenhum produto encontrado para este filtro.
              </p>
            )}
          </div>
        </div>

        <div className="lg:col-span-5 xl:col-span-4">
          <Card
            className="sticky top-36 border-teal-200 bg-emerald-50/50 shadow-xs"
            data-testid="pos-cart-container"
          >
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base font-bold tracking-tight text-emerald-900">
                <ShoppingCart className="size-4" />
                Carrinho ({cartLines.length})
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <ul className="space-y-2">
                {cartLines.map(({ product, quantity }) => (
                  <li
                    key={product.id}
                    data-testid={`pos-cart-item-${product.id}`}
                    className="flex items-center gap-2 rounded-lg border border-emerald-100 bg-white px-3 py-2"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-semibold text-slate-900">{product.name}</p>
                      <p className="font-mono text-xs tabular-nums text-slate-500">
                        {quantity} × {money(product.sale_price)} ={" "}
                        {money(quantity * product.sale_price)}
                      </p>
                    </div>
                    <div className="flex items-center gap-1">
                      <Button
                        size="icon-xs"
                        variant="outline"
                        aria-label={`Diminuir quantidade de ${product.name}`}
                        data-testid={`pos-cart-qty-dec-${product.id}`}
                        onClick={() => decrement(product.id)}
                      >
                        <Minus className="size-3" />
                      </Button>
                      <Button
                        size="icon-xs"
                        variant="outline"
                        aria-label={`Aumentar quantidade de ${product.name}`}
                        data-testid={`pos-cart-qty-inc-${product.id}`}
                        onClick={() => addToCart(product)}
                        disabled={quantity >= product.current_stock}
                      >
                        <Plus className="size-3" />
                      </Button>
                      <Button
                        size="icon-xs"
                        variant="ghost"
                        aria-label={`Remover ${product.name} do carrinho`}
                        data-testid={`pos-cart-item-remove-${product.id}`}
                        onClick={() => removeLine(product.id)}
                      >
                        <Trash2 className="size-3 text-red-600" />
                      </Button>
                    </div>
                  </li>
                ))}
                {cartLines.length === 0 && (
                  <li className="rounded-lg border border-dashed border-emerald-200 p-6 text-center text-sm text-emerald-800">
                    Carrinho vazio — toque em “Add” em um produto.
                  </li>
                )}
              </ul>

              <div className="space-y-3 border-t border-emerald-200 pt-4">
                <div className="flex items-center justify-between text-sm">
                  <span className="font-medium text-slate-600">Subtotal</span>
                  <span className="font-mono font-semibold tabular-nums" data-testid="pos-cart-subtotal">
                    {money(subtotal)}
                  </span>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <Label htmlFor="pos-discount" className="text-xs font-semibold uppercase tracking-wider text-slate-500">
                      Desconto
                    </Label>
                    <Input
                      id="pos-discount"
                      value={discount}
                      onChange={(event) => setDiscount(event.target.value)}
                      inputMode="decimal"
                      data-testid="pos-discount-input"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs font-semibold uppercase tracking-wider text-slate-500">
                      Pagamento
                    </Label>
                    <Select
                      value={payment}
                      onValueChange={(value: string) => setPayment(value as PaymentMethod)}
                    >
                      <SelectTrigger data-testid="pos-payment-select">
                        <SelectValue>
                          {(value) => PAYMENT_LABELS[value as PaymentMethod]}
                        </SelectValue>
                      </SelectTrigger>
                      <SelectContent>
                        {PAYMENTS.map((method) => (
                          <SelectItem key={method} value={method}>
                            {PAYMENT_LABELS[method]}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                <div className="flex items-end justify-between border-t border-emerald-200 pt-3">
                  <span className="text-sm font-semibold text-emerald-900">Total</span>
                  <span
                    className="font-mono text-2xl font-bold tabular-nums text-emerald-700"
                    data-testid="pos-cart-total"
                  >
                    {money(total)}
                  </span>
                </div>

                <div className="flex gap-2">
                  <Button
                    className="flex-1 active:scale-[0.98]"
                    disabled={cartLines.length === 0 || finalize.isPending}
                    data-testid="pos-btn-finalize"
                    onClick={() =>
                      finalize.mutate({
                        items: cartLines.map((l) => ({
                          product_id: l.product.id,
                          quantity: l.quantity,
                        })),
                        payment_method: payment,
                        discount: discountValue,
                        notes: "",
                      })
                    }
                  >
                    {finalize.isPending ? "Finalizando…" : "Finalizar Venda"}
                  </Button>
                  <Button
                    variant="outline"
                    onClick={() => {
                      setCart({});
                      setDiscount("0");
                    }}
                    disabled={cartLines.length === 0}
                    data-testid="pos-btn-clear"
                  >
                    Limpar
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>

      <Dialog open={receipt !== null} onOpenChange={(open) => !open && setReceipt(null)}>
        <DialogContent data-testid="pos-receipt-modal">
          <DialogHeader>
            <DialogTitle>Venda registrada</DialogTitle>
            <DialogDescription>
              Estoque atualizado automaticamente. Imprima o cupom ou envie pelo WhatsApp.
            </DialogDescription>
          </DialogHeader>

          {receipt && (
            <div
              className="receipt-print-area space-y-2 rounded-lg border border-dashed border-slate-300 bg-white p-4 font-mono text-sm"
              data-testid="pos-receipt-sheet"
            >
              <div className="text-center">
                {branding?.logo && (
                  <img
                    src={branding.logo}
                    alt=""
                    className="mx-auto mb-2 max-h-16 object-contain"
                    data-testid="receipt-logo"
                  />
                )}
                <p className="text-base font-bold tracking-tight" data-testid="receipt-company">
                  {headerName}
                </p>
                {branding?.cnpj?.trim() && (
                  <p className="text-xs" data-testid="receipt-cnpj">CNPJ: {branding.cnpj}</p>
                )}
                {branding?.address?.trim() && (
                  <p className="text-xs" data-testid="receipt-address">{branding.address}</p>
                )}
                {branding?.phone?.trim() && (
                  <p className="text-xs" data-testid="receipt-phone">Tel: {branding.phone}</p>
                )}
                <p className="text-xs" data-testid="receipt-code">
                  Cupom {receipt.code}
                </p>
                <p className="text-xs" data-testid="receipt-datetime">
                  {formatDateTime(receipt.created_at)}
                </p>
                <p className="text-xs" data-testid="receipt-seller">
                  Vendedor: {receipt.seller_name || "—"}
                </p>
              </div>
              <div className="border-t border-dashed border-slate-300 pt-2">
                {receipt.items.map((item) => (
                  <div key={item.product_id} className="flex justify-between gap-3">
                    <span className="truncate">
                      {item.quantity}× {item.product_name}
                    </span>
                    <span className="tabular-nums">{money(item.line_total)}</span>
                  </div>
                ))}
              </div>
              <div className="space-y-0.5 border-t border-dashed border-slate-300 pt-2">
                <div className="flex justify-between">
                  <span>Subtotal</span>
                  <span className="tabular-nums">{money(receipt.subtotal)}</span>
                </div>
                {receipt.discount > 0 && (
                  <div className="flex justify-between">
                    <span>Desconto</span>
                    <span className="tabular-nums">- {money(receipt.discount)}</span>
                  </div>
                )}
                <div className="flex justify-between text-base font-bold">
                  <span>TOTAL</span>
                  <span className="tabular-nums" data-testid="pos-receipt-total">
                    {money(receipt.total)}
                  </span>
                </div>
                <div className="flex justify-between text-xs">
                  <span>Pagamento</span>
                  <span>{PAYMENT_LABELS[receipt.payment_method]}</span>
                </div>
              </div>
              <p className="pt-2 text-center text-xs">Obrigado pela preferência!</p>
            </div>
          )}

          <div className="space-y-2 print:hidden">
            <Label htmlFor="pos-whatsapp-phone" className="text-xs font-semibold uppercase tracking-wider text-slate-500">
              WhatsApp do cliente (opcional)
            </Label>
            <Input
              id="pos-whatsapp-phone"
              value={phone}
              onChange={(event) => setPhone(event.target.value)}
              placeholder="(11) 98888-7777"
              inputMode="tel"
              data-testid="pos-whatsapp-phone-input"
            />
          </div>

          <DialogFooter className="print:hidden">
            <Button
              variant="outline"
              onClick={() => printReceipt()}
              data-testid="pos-receipt-print-btn"
            >
              <Printer className="size-4" />
              Imprimir
            </Button>
            {receipt && (
              <a
                href={whatsappLink(receiptText(receipt, company, branding), phone)}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-2 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition-colors duration-150 ease-out hover:bg-emerald-700 active:scale-[0.98]"
                data-testid="pos-receipt-whatsapp-btn"
              >
                <MessageCircle className="size-4" />
                Enviar no WhatsApp
              </a>
            )}
            <Button onClick={() => setReceipt(null)} data-testid="pos-receipt-close">
              Nova venda
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

    </AppShell>
  );
}
