import { revealHidden } from "../../../supabase/functions/_shared/textSafety";

/**
 * Text exactly as an agent will read it, with every invisible character
 * spelled out. Review cards use it for anything an agent wrote: what the
 * person approves has to be what the model gets, character for character.
 */
export function Revealed({ text, className, block = false }: { text: string; className?: string; block?: boolean }) {
  const { text: shown, hidden } = revealHidden(text);
  const Tag = block ? "pre" : "span";
  return (
    <>
      <Tag className={className}>{shown}</Tag>
      {hidden > 0 && (
        <span className="block text-xs text-destructive" role="note">
          {hidden} invisible character{hidden === 1 ? "" : "s"} shown as ⟦U+…⟧ — an agent reads them; you would not have seen them.
        </span>
      )}
    </>
  );
}
