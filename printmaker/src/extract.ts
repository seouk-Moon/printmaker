import type { SourcePage } from "./model";
export async function readSource(file: File, progress: (message:string)=>void): Promise<SourcePage[]> {
  if(file.size > 30*1024*1024) throw new Error("파일은 30MB 이하로 올려 주세요.");
  if(/\.(txt|md)$/i.test(file.name)) {
    const text = await file.text();
    if(text.length > 120000) throw new Error("텍스트는 120,000자 이하로 나눠 주세요.");
    return [{number:1,name:file.name,text,image:""}];
  }
  if(/\.(png|jpe?g|webp)$/i.test(file.name)) {
    const bitmap = await createImageBitmap(file);
    try {
      const scale = Math.min(1,1800/Math.max(bitmap.width,bitmap.height));
      const canvas=document.createElement("canvas"); canvas.width=Math.round(bitmap.width*scale);canvas.height=Math.round(bitmap.height*scale);
      const ctx=canvas.getContext("2d")!;ctx.fillStyle="#fff";ctx.fillRect(0,0,canvas.width,canvas.height);ctx.drawImage(bitmap,0,0,canvas.width,canvas.height);
      return [{number:1,name:file.name,text:"",image:canvas.toDataURL("image/jpeg",0.9)}];
    } finally {bitmap.close();}
  }
  if(!/\.pdf$/i.test(file.name)) throw new Error("PDF, PNG, JPG, WEBP, TXT 파일을 지원합니다. HWP·DOCX는 PDF로 저장해 올려 주세요.");
  const pdfjs = await import("pdfjs-dist");
  pdfjs.GlobalWorkerOptions.workerSrc = (await import("pdfjs-dist/build/pdf.worker.min.mjs?url")).default;
  const pdf = await pdfjs.getDocument({data:await file.arrayBuffer()}).promise;
  try {
    if(pdf.numPages > 20) throw new Error(`이 파일은 ${pdf.numPages}페이지입니다. 누락 방지를 위해 20페이지 이하로 나눠 올려 주세요.`);
    const pages: SourcePage[]=[];
    for(let n=1;n<=pdf.numPages;n++) {
      progress(`${n}/${pdf.numPages}페이지 읽는 중`);
      const page=await pdf.getPage(n);const unit=page.getViewport({scale:1});
      const viewport=page.getViewport({scale:Math.min(2.4,1800/Math.max(unit.width,unit.height))});
      const canvas=document.createElement("canvas");canvas.width=Math.ceil(viewport.width);canvas.height=Math.ceil(viewport.height);
      await page.render({canvas,viewport}).promise;
      const content=await page.getTextContent();
      let text="";let previousY:number|undefined;
      for(const item of content.items) {
        if(!("str" in item)) continue;
        if(previousY!==undefined && Math.abs(item.transform[5]-previousY)>3) text+="\n";
        text+=item.str+(item.hasEOL?"\n":" ");previousY=item.transform[5];
      }
      pages.push({number:n,name:file.name,text:text.trim(),image:canvas.toDataURL("image/jpeg",0.9)});
      page.cleanup();
    }
    return pages;
  } finally {await pdf.destroy();}
}
/** Box is [top,left,bottom,right], normalized to 0..1000 as returned by Gemini. */
export async function cropFigure(image: string, box: number[]): Promise<string> {
  if(box.length!==4 || !box.every(Number.isFinite)) throw new Error("그림 영역이 올바르지 않습니다.");
  const [top,left,bottom,right]=box.map(v=>Math.max(0,Math.min(1000,v)));
  if(bottom-top<5 || right-left<5) throw new Error("그림 영역을 조금 더 크게 선택해 주세요.");
  const img=new Image();img.src=image;await img.decode();
  const sx=left/1000*img.naturalWidth,sy=top/1000*img.naturalHeight;
  const sw=(right-left)/1000*img.naturalWidth,sh=(bottom-top)/1000*img.naturalHeight;
  const canvas=document.createElement("canvas");canvas.width=Math.ceil(sw);canvas.height=Math.ceil(sh);
  canvas.getContext("2d")!.drawImage(img,sx,sy,sw,sh,0,0,canvas.width,canvas.height);
  return canvas.toDataURL("image/png");
}
