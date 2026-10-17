import { useUi, useInspectable } from '../uiContext';
import { fmt } from '../format';

export type Kind = 'MED' | 'CALC' | 'CMD' | 'VERD';

export const KIND_TITLE: Record<Kind, string> = {
  MED: 'Medição simulada de sensor',
  CALC: 'Valor calculado (a partir do modelo ou de medições)',
  CMD: 'Comando / ordem (operador ou controle automático)',
  VERD: 'Valor verdadeiro do modelo físico (referência)',
};

export function KindTag({ kind }: { kind: Kind }) {
  return (
    <span className={`kind ${kind}`} title={KIND_TITLE[kind]}>
      {kind}
    </span>
  );
}

export function Readout(props: {
  label: string;
  value: number | string;
  unit?: string;
  digits?: number;
  kind: Kind;
  truth?: number;
  status?: 'warn' | 'alarm' | '';
  inspect?: string;
  title?: string;
}) {
  const ui = useUi();
  const insp = useInspectable(props.inspect ?? '');
  const v = typeof props.value === 'number' ? fmt(props.value, props.digits ?? 1) : props.value;
  return (
    <div className={`ro ${props.status ?? ''}`} {...(props.inspect ? insp : {})} title={props.title}>
      <div className="lbl">
        <span>{props.label}</span>
        <KindTag kind={props.kind} />
      </div>
      <div className="val">
        {v}
        {props.unit && <small>{props.unit}</small>}
      </div>
      {ui.eng && props.truth !== undefined && (
        <div className="truth" title={KIND_TITLE.VERD}>
          real: {fmt(props.truth, (props.digits ?? 1) + 1)} {props.unit}
        </div>
      )}
    </div>
  );
}
