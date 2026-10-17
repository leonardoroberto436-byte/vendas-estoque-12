import { Button } from "@/components/ui/button";

/** Quantos itens desenhar por vez — 40 mil de uma vez travariam o navegador. */
export const PAGE_SIZE = 200;

export default function ShowMore({
  shown,
  total,
  onMore,
}: {
  shown: number;
  total: number;
  onMore: () => void;
}) {
  if (shown >= total) return null;
  return (
    <div className="col-span-full flex flex-col items-center gap-2 py-4 text-sm text-slate-500">
      <span>
        Mostrando {shown.toLocaleString("pt-BR")} de {total.toLocaleString("pt-BR")}. Use a busca
        para achar um produto específico.
      </span>
      <Button variant="outline" size="sm" onClick={onMore} data-testid="show-more">
        Mostrar mais
      </Button>
    </div>
  );
}
