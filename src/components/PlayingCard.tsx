import type { Card } from "../game/engine";
import { rankLabel, suitIsRed, suitSymbol } from "../client/table-ui";

interface Props {
  card?: Card | null;
  faceDown?: boolean;
  small?: boolean;
  delayMs?: number;
}

/** A single playing card. Face-down renders the club's gold-on-emerald back;
 *  the server never sends other players' cards, so opponents are always
 *  rendered face-down by construction. */
export default function PlayingCard({ card, faceDown, small, delayMs = 0 }: Props) {
  const cls = `playing-card${small ? " playing-card-small" : ""}`;
  const style = { animationDelay: `${delayMs}ms` };
  if (faceDown || !card) {
    return (
      <div className={`${cls} playing-card-back`} style={style} aria-label="Hidden card">
        <span>TP</span>
      </div>
    );
  }
  const red = suitIsRed(card.suit);
  return (
    <div
      className={`${cls}${red ? " playing-card-red" : ""}`}
      style={style}
      aria-label={`${rankLabel(card.rank)} of ${card.suit}`}
    >
      <span className="playing-card-rank">{rankLabel(card.rank)}</span>
      <span className="playing-card-suit">{suitSymbol(card.suit)}</span>
    </div>
  );
}
