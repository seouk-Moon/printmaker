import test from 'node:test';
import assert from 'node:assert/strict';
import {emptyWorksheet,newQuestion,parseWorksheet} from '../src/model.ts';
import {findSourcePage,mergeSourcePages,applySourceCrop} from '../src/source-review.ts';
const image='data:image/png;base64,AAAA';
const a={id:'hash-a:1',name:'same.pdf',number:1,text:'',image};
const b={...a,id:'hash-b:1'};
test('source identity disambiguates equal file names and refuses a wrong file',()=>{
 const q=newQuestion({sourceId:a.id,sourceName:a.name,sourcePage:1});
 assert.equal(findSourcePage(q,[b,a]),a);assert.equal(findSourcePage(q,[b]),undefined);
 const legacy=newQuestion({sourceName:a.name,sourcePage:1});
 assert.equal(findSourcePage(legacy,[a]),a);assert.equal(findSourcePage(legacy,[a,b]),undefined);
 assert.equal(findSourcePage(q,[a,b],{id:'f',caption:'',dataUrl:image,sourceId:b.id}),b);
});
test('reupload keeps other source files and replaces only the same source identity',()=>{
 const fresh={...a,text:'new'};assert.deepEqual(mergeSourcePages([a,b],[fresh]),[b,fresh]);
 assert.throws(()=>mergeSourcePages(Array.from({length:60},(_,i)=>({...a,id:String(i)})),[b]),/60/);
});
test('crop replacement preserves problem text, caption, figure IDs and other questions',()=>{
 const q=newQuestion({text:'Original problem',reviewed:true,figures:[{id:'f1',caption:'original caption',dataUrl:image},{id:'f2',caption:'second',dataUrl:image}]});
 const other=newQuestion({text:'Other problem'});const doc={...emptyWorksheet(),questions:[q,other]};
 const before=JSON.stringify(doc);const next=applySourceCrop(doc,q.id,'f1',a,'data:image/png;base64,BBBB',[10,20,800,900]);
 assert.equal(JSON.stringify(doc),before);assert.equal(next.questions[0].text,q.text);assert.equal(next.questions[0].figures[0].id,'f1');assert.equal(next.questions[0].figures[0].caption,'original caption');assert.equal(next.questions[0].figures[0].sourceId,a.id);assert.equal(next.questions[0].reviewed,false);assert.deepEqual(next.questions[0].figures[1],q.figures[1]);assert.deepEqual(next.questions[1],other);
 assert.throws(()=>applySourceCrop(doc,q.id,'missing',a,image,[0,0,100,100]));
});
test('missing figure can be added; old backups remain compatible; invalid bounds rejected',()=>{
 const q=newQuestion();const doc={...emptyWorksheet(),questions:[q]};assert.deepEqual(parseWorksheet(doc),doc);
 const next=applySourceCrop(doc,q.id,null,a,image,[0,0,500,500]);assert.equal(next.questions[0].figures.length,1);assert.equal(next.questions[0].figures[0].sourcePage,1);
 assert.throws(()=>parseWorksheet({...doc,questions:[{...q,sourceBox:[900,0,100,900]}]}));
 assert.throws(()=>applySourceCrop(doc,q.id,null,a,image,[0,0,0,100]));
});
