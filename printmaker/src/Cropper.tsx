import { useEffect, useRef, useState } from 'react';
import type { SourceBox, SourcePage } from './model';
import { isSourceBox } from './model';


export function Cropper({ page, onCrop, disabled, initialBox, buttonLabel = '선택 그림을 문제에 넣기' }: {
  page: SourcePage;
  onCrop: (image: string, box: SourceBox) => void;
  disabled: boolean;
  initialBox?: SourceBox;
  buttonLabel?: string;
}) {
  const stage = useRef<HTMLDivElement>(null);
  const start = useRef<number[] | null>(null);
  const alive = useRef(true);
  const [box, setBox] = useState<SourceBox | null>(initialBox ?? null);
  const [error, setError] = useState('');
  const [cropping, setCropping] = useState(false);
  const boxKey = JSON.stringify(initialBox);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  useEffect(() => {
    setBox(initialBox ?? null); setError('');
    if (initialBox) {
      const frame = requestAnimationFrame(() => stage.current?.querySelector('.crop-box')?.scrollIntoView({ block: 'center', behavior: 'smooth' }));
      return () => cancelAnimationFrame(frame);
    }
  }, [page.id, page.name, page.number, boxKey]);
  const point = (clientX: number, clientY: number) => {
    const rect = stage.current!.getBoundingClientRect();
    return [Math.max(0,Math.min(1000,(clientY-rect.top)/rect.height*1000)),Math.max(0,Math.min(1000,(clientX-rect.left)/rect.width*1000))];
  };
  const apply = async () => {
    if (!box || disabled || cropping) return;
    setCropping(true); setError('');
    try {
      const { cropFigure } = await import("./extract");
      const image = await cropFigure(page.image, box);
      if (alive.current) onCrop(image, box);
    } catch (caught) { if (alive.current) setError(caught instanceof Error ? caught.message : '그림을 자르지 못했어요.'); }
    finally { if (alive.current) setCropping(false); }
  };
  return <div className="cropper">
    <p className="hint">본문의 그림·표·수식을 손가락이나 마우스로 감싸 주세요. 선택된 파란 영역이 문제에 들어갑니다.</p>
    <div ref={stage} className="crop-stage" onPointerDown={event => {
      if (disabled || cropping) return;
      event.currentTarget.setPointerCapture(event.pointerId);
      start.current = point(event.clientX,event.clientY);
      setBox([...start.current,...start.current] as SourceBox);
    }} onPointerMove={event => {
      if (!start.current) return;
      const next = point(event.clientX,event.clientY);
      setBox([Math.min(next[0],start.current[0]),Math.min(next[1],start.current[1]),Math.max(next[0],start.current[0]),Math.max(next[1],start.current[1])]);
    }} onPointerUp={() => { start.current = null; }} onPointerCancel={() => { start.current = null; }}>
      <img src={page.image} alt={`${page.name} ${page.number}페이지 원본`} draggable={false}/>
      {box && <div className="crop-box" style={{top:`${box[0]/10}%`,left:`${box[1]/10}%`,height:`${(box[2]-box[0])/10}%`,width:`${(box[3]-box[1])/10}%`}}/>}
    </div>
    <div className="row crop-commands"><button type="button" disabled={disabled || cropping} onClick={() => setBox([0,0,1000,1000])}>페이지 전체 선택</button><button type="button" disabled={disabled || cropping} onClick={() => setBox(null)}>선택 지우기</button></div>
    {box && <details className="crop-numeric"><summary>선택 영역 숫자로 조절</summary><div>{box.map((value,index) => <label key={index}>{['위','왼쪽','아래','오른쪽'][index]} %<input type="number" min="0" max="100" step="0.1" value={Math.round(value)/10} disabled={disabled || cropping} onChange={event => setBox(old => old ? old.map((item,i) => i === index ? Math.min(1000,Math.max(0,Number(event.target.value)*10)) : item) as SourceBox : old)}/></label>)}</div></details>}
    <button type="button" className="primary wide crop-apply" disabled={!box || !isSourceBox(box) || disabled || cropping} onClick={() => void apply()}>{cropping ? '그림을 넣는 중…' : buttonLabel}</button>
    {error && <p role="alert" className="error">{error}</p>}
  </div>;
}
