import { useEffect, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { apiPost } from "@/lib/api";
import type { MovementType, Product, StockMovement, StockMovementCreate } from "@/lib/types";
import { MOVEMENT_LABELS, errorMessage } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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

const ENTRY_TYPES: MovementType[] = ["ENTRADA"];
const ADJUST_TYPES: MovementType[] = ["AJUSTE_POSITIVO", "AJUSTE_NEGATIVO", "PERDA"];

interface Props {
  mode: "ENTRADA" | "AJUSTE";
  open: boolean;
  onOpenChange: (open: boolean) => void;
  products: Product[];
  presetProductId?: string;
}

/** Shared dialog for stock entries and manual adjustments (POST /api/stock/movements). */
export default function MovementDialog({
  mode,
  open,
  onOpenChange,
  products,
  presetProductId,
}: Props) {
  const queryClient = useQueryClient();
  const types = mode === "ENTRADA" ? ENTRY_TYPES : ADJUST_TYPES;
  const [productId, setProductId] = useState(presetProductId ?? "");
  const [type, setType] = useState<MovementType>(types[0]);
  const [quantity, setQuantity] = useState("1");
  const [reason, setReason] = useState("");

  useEffect(() => {
    if (open) {
      setProductId(presetProductId ?? "");
      setType(mode === "ENTRADA" ? "ENTRADA" : "AJUSTE_POSITIVO");
      setQuantity("1");
      setReason("");
    }
  }, [open, presetProductId, mode]);

  const prefix = mode === "ENTRADA" ? "stock-in" : "stock-adjust";

  const submit = useMutation({
    mutationFn: (payload: StockMovementCreate) =>
      apiPost<StockMovement>("/stock/movements", payload),
    onSuccess: () => {
      toast.success("Estoque atualizado");
      onOpenChange(false);
      void queryClient.invalidateQueries({ queryKey: ["products"] });
      void queryClient.invalidateQueries({ queryKey: ["movements"] });
      void queryClient.invalidateQueries({ queryKey: ["dashboard-stats"] });
    },
    onError: (error) => toast.error(errorMessage(error, "Não foi possível atualizar o estoque")),
  });

  const qty = Math.max(1, Math.trunc(Number(quantity.replace(",", ".")) || 0));

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent data-testid={`${prefix}-modal`}>
        <DialogHeader>
          <DialogTitle>
            {mode === "ENTRADA" ? "Nova entrada de estoque" : "Ajuste manual de inventário"}
          </DialogTitle>
          <DialogDescription>
            {mode === "ENTRADA"
              ? "Registre a reposição recebida de fornecedor."
              : "Corrija o estoque após contagem, quebra ou devolução."}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label>Produto</Label>
            <Select value={productId} onValueChange={(value: string) => setProductId(value)}>
              <SelectTrigger data-testid={`${prefix}-product-select`}>
                <SelectValue placeholder="Selecione o produto">
                  {(value) =>
                    products.find((p) => p.id === value)?.name ?? "Selecione o produto"
                  }
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                {products.map((product) => (
                  <SelectItem key={product.id} value={product.id}>
                    {product.name} — {product.current_stock} un.
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {mode === "AJUSTE" && (
            <div className="space-y-1.5">
              <Label>Tipo de ajuste</Label>
              <Select value={type} onValueChange={(value: string) => setType(value as MovementType)}>
                <SelectTrigger data-testid="stock-adjust-type-select">
                  <SelectValue>
                    {(value) => MOVEMENT_LABELS[value as MovementType]}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {ADJUST_TYPES.map((item) => (
                    <SelectItem key={item} value={item}>
                      {MOVEMENT_LABELS[item]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          <div className="space-y-1.5">
            <Label htmlFor={`${prefix}-qty`}>Quantidade</Label>
            <Input
              id={`${prefix}-qty`}
              inputMode="numeric"
              value={quantity}
              onChange={(event) => setQuantity(event.target.value)}
              data-testid={`${prefix}-quantity-input`}
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor={`${prefix}-reason`}>
              {mode === "ENTRADA" ? "Observação" : "Motivo"}
            </Label>
            <Input
              id={`${prefix}-reason`}
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              placeholder={mode === "ENTRADA" ? "Ex.: NF 1234 fornecedor" : "Ex.: contagem física"}
              data-testid={mode === "ENTRADA" ? "stock-in-notes-input" : "stock-adjust-reason-input"}
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} data-testid={`${prefix}-cancel-btn`}>
            Cancelar
          </Button>
          <Button
            disabled={!productId || submit.isPending}
            data-testid={`${prefix}-submit-btn`}
            onClick={() => submit.mutate({ product_id: productId, type, quantity: qty, reason })}
          >
            {submit.isPending ? "Salvando…" : "Confirmar"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
