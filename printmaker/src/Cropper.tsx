import { useRef, useState } from "react";
import type { SourcePage } from "./model";
import { cropFigure } from "./extract";

export function Cropper({page,onCrop,disabled}:{page:SourcePage;onCrop:(image:string)=>void;disabled:boolean}) {
  const ref=useRef<HTMLDivElement>(null);
  const [start,setStart]=useState<number[]|null>(null);const [box,setBox]=useState<number[]|null>(null);
  const [error,setError]=useState("");
  const point=(clientX:number,clientY:number)=>{const rect=ref.current!.getBoundingClientRect();return [Math.max(0,Math.min(1000,(clientY-rect.top)/rect.height*1000)),Math.max(0,Math.min(1000,(clientX-rect.left)/rect.width*1000))];};
  return <div className="cropper">
    <p className="hint">그림·표·복잡한 수식은 드래그해 선택하세요. 전체 문제를 그림으로 보존할 수도 있습니다.</p>
    <div ref={ref} className="crop-stage" onPointerDown={e=>{if(disabled)return;e.currentTarget.setPointerCapture(e.pointerId);const p=point(e.clientX,e.clientY);setStart(p);setBox([...p,...p]);}}
      onPointerMove={e=>{if(!start)return;const p=point(e.clientX,e.clientY);setBox([Math.min(p[0],start[0]),Math.min(p[1],start[1]),Math.max(p[0],start[0]),Math.max(p[1],start[1])]);}}
      onPointerUp={()=>setStart(null)} onPointerCancel={()=>setStart(null)}>
      <img src={page.image} alt={`${page.name} ${page.number}페이지 원본`} draggable={false}/>
      {box&&<div className="crop-box" style={{top:`${box[0]/10}%`,left:`${box[1]/10}%`,height:`${(box[2]-box[0])/10}%`,width:`${(box[3]-box[1])/10}%`}}/>}
    </div>
    <div className="row"><button type="button" disabled={disabled} onClick={()=>setBox([0,0,1000,1000])}>페이지 전체 선택</button><button type="button" disabled={!box||disabled} onClick={async()=>{try{setError("");onCrop(await cropFigure(page.image,box!));setBox(null);}catch(e){setError(e instanceof Error?e.message:"자르기 실패");}}}>선택 그림을 문제에 넣기</button></div>
    {error&&<p role="alert" className="error">{error}</p>}
  </div>;
}
