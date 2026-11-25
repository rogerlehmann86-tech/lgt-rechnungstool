import test from 'node:test';
import assert from 'node:assert/strict';
import {detectDocumentTitle,originalInvoiceDate} from '../invoice.js';
const item=(str,x,y=620)=>({str,transform:[1,0,0,1,x,y],width:str.length*6,height:12});
function page(titleItems,date='Sutz, 23.11.2026'){
 const items=[...titleItems,item(date,330)];
 return {width:595,height:842,items,rows:[{y:620,items},{y:510,items:[item('Rechnung als Referenz in Artikeltext',40,510)]}]};
}
for(const title of ['Proformarechnung','Kostenvoranschlag','Rechnung','Rechnung Nr. 31775','Proforma-Rechnung']){
 test('recognises '+title,()=>{const p=page([item(title,40)]);assert.ok(detectDocumentTitle(p));});
}
test('split heading and number',()=>{const p=page([item('Rechnung',40),item('Nr. 31775',110)]);assert.equal(detectDocumentTitle(p).type,'Rechnung');assert.equal(originalInvoiceDate(p,detectDocumentTitle(p)),'2026-11-23');});
test('estimate is not existing invoice',()=>{const p=page([item('Kostenvoranschlag',40)]);assert.equal(originalInvoiceDate(p,detectDocumentTitle(p)),'');});
test('unknown document rejected',()=>{assert.equal(detectDocumentTitle(page([item('Lieferschein',40)])),null);});
test('ambiguous headings rejected',()=>{const p=page([item('Rechnung',40)]);p.rows.push({y:570,items:[item('Kostenvoranschlag',40,570)]});assert.equal(detectDocumentTitle(p),null);});
test('invalid existing date rejected',()=>{const p=page([item('Rechnung',40)],'Sutz, 31.02.2026');assert.equal(originalInvoiceDate(p,detectDocumentTitle(p)),'');});
