/**
 * Apresentação do Estúdio em andamento numa etapa que abre outra tela (mapa,
 * lastro, sala de comando…): o cartão flutua sobre a tela, com os controles do
 * apresentador e um atalho de volta ao palco.
 */
import { runner, useSim } from '../store';
import { presPlayer } from '../presBuilder/player';
import { PresCardView, PresHudView } from './PresCard';
import { usePersisted } from '../persist';

export function PresFloating({ onStage }: { onStage: () => void }) {
  const e = useSim(6);
  const [small, setSmall] = usePersisted('studio.floatSmall', false);
  const pl = presPlayer;
  if (!pl.active && !pl.ff) return null;
  const card = pl.card(e);
  if (!card) return null;
  const busy = !!pl.ff;
  const c = { ...card, format: { ...card.format, style: card.format.style === 'oculto' || small ? ('oculto' as const) : ('cartao' as const), position: 'baixo' as const, size: 'P' as const } };
  return (
    <div className="pres-float">
      {!small && <PresHudView items={pl.hud(e)} />}
      <PresCardView c={c} compact>
        <div className="row pc-float-ctl">
          {small && (
            <b className="pc-float-title">
              {card.k + 1}/{card.n} {card.title}
            </b>
          )}
          <span className="btngroup">
            <button className="btn sm" disabled={busy} onClick={() => pl.prev(runner)} title="Etapa anterior (← / Page Up)">
              ◀
            </button>
            <button className="btn sm" disabled={busy} onClick={() => pl.pause(runner)} title="Pausar/continuar (Espaço)">
              {pl.paused ? '▶' : '❚❚'}
            </button>
            <button className="btn sm ok" disabled={busy} onClick={() => pl.next(runner)} title="Próxima etapa (→ / Page Down)">
              Próxima ▶
            </button>
          </span>
          <span className="btngroup">
            <button className="btn sm" onClick={() => setSmall(!small)} title={small ? 'Mostrar o texto' : 'Recolher o texto'}>
              {small ? '▴' : '▾'}
            </button>
            <button className="btn sm" onClick={onStage} title="Voltar ao palco do Estúdio">
              Palco
            </button>
            <button className="btn sm warn" onClick={() => pl.stop(runner)} title="Encerrar a apresentação">
              ■
            </button>
          </span>
        </div>
      </PresCardView>
    </div>
  );
}
