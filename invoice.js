import { parseMoney, parseVatBps, recalculate, formatMoney, chDate, sourceRoundingAllowed } from './money.js?v=20261125-import4';
const PDFJS_VERSION = '6.5.438';
let pdfjs;
async function getPdfJs() {
  if (!pdfjs) {
    pdfjs = await import(`https://cdn.jsdelivr.net/npm/pdfjs-dist@${PDFJS_VERSION}/build/pdf.mjs`);
    pdfjs.GlobalWorkerOptions.workerSrc = `https://cdn.jsdelivr.net/npm/pdfjs-dist@${PDFJS_VERSION}/build/pdf.worker.mjs`;
  }
  return pdfjs;
}
function normalize(s) { return String(s??'').replace(/\s+/g,' ').trim(); }
function rowText(row) { return row.items.map(i=>i.str).join(' ').replace(/\s+/g,' ').trim(); }
export function makeRows(items) {
  const rows = [];
  for (const item of items.filter(i=>normalize(i.str))) {
    const y = item.transform[5];
    let row = rows.find(r => Math.abs(r.y-y) < 2.7);
    if (!row) { row = {y,items:[]}; rows.push(row); }
    row.items.push(item);
  }
  rows.forEach(r=>r.items.sort((a,b)=>a.transform[4]-b.transform[4]));
  rows.sort((a,b)=>b.y-a.y);
  return rows;
}
function lineAmount(text) {
  const clean=normalize(text).replace(/\b(?:Fr\.?|CHF)\s*/gi,'');
  const matches=[...clean.matchAll(/-?\s*\d[\d’'\s]*[.,]\d{2}(?!\d)/g)];
  if (!matches.length) return null;
  try { return parseMoney(matches.at(-1)[0]); } catch { return null; }
}
export function parseSummary(rows) {
  const entries = rows.map(r=>({row:r,text:rowText(r)}));
  const take=(re)=>entries.find(e=>re.test(e.text));
  const sum=entries.find(e=>/^Summe\b/i.test(e.text)&&lineAmount(e.text)!==null);
  const vat=sum&&entries.find(e=>e.row.y<sum.row.y && /^MwSt\.?\s*\d{1,2}(?:[.,]\d{1,2})?\s*%/i.test(e.text)&&lineAmount(e.text.replace(/^MwSt\.?\s*\d{1,2}(?:[.,]\d{1,2})?\s*%/i,''))!==null);
  const total=vat&&entries.find(e=>e.row.y<vat.row.y&&/^Total\b/i.test(e.text)&&lineAmount(e.text)!==null);
  if (!sum||!vat||!total) return null;
  const bpsMatch=vat.text.match(/MwSt\.?\s*(\d{1,2}(?:[.,]\d{1,2})?)\s*%/i);
  if(!bpsMatch) return null;
  try {
    const originalNet=lineAmount(sum.text), originalVat=lineAmount(vat.text), originalTotal=lineAmount(total.text);
    if ([originalNet,originalVat,originalTotal].some(n=>n===null)) return null;
    return {originalNet,originalVat,originalTotal,vatBps:parseVatBps(bpsMatch[1]),
      rowSum:sum.row,rowVat:vat.row,rowTotal:total.row};
  } catch {return null;}
}
// Only recognise document headings on the first page, not references in item descriptions.
export function detectDocumentTitle(page) {
  const pattern=/^(Proforma\s*[-–]?\s*rechnung|Kostenvoranschlag|Lieferschein|Rechnung)(?=\s|:|$)(?:\s*(?:Nr\.?|Nummer|#)\s*:?\s*(\d{3,10})|\s+(\d{3,10}))?\s*:?\s*$/i;
  const candidates=[];
  for(const row of page.rows){
    if(row.y<page.height*.48)continue;
    const left=row.items.filter(i=>normalize(i.str)&&i.transform[4]<page.width*.48).sort((a,b)=>a.transform[4]-b.transform[4]);
    if(!left.length)continue;
    const match=normalize(left.map(i=>i.str).join(' ')).match(pattern);
    if(!match)continue;
    const type=/^proforma/i.test(match[1])?'Proformarechnung':/^kosten/i.test(match[1])?'Kostenvoranschlag':/^liefer/i.test(match[1])?'Lieferschein':'Rechnung';
    candidates.push({type,number:match[2]||match[3]||'',item:left[0],items:left,row});
  }
  return candidates.length===1?candidates[0]:null;
}
export function originalInvoiceDate(page,title) {
  if(!title||title.type!=='Rechnung')return '';
  const text=rowText(title.row);
  const m=text.match(/\bSutz\s*,\s*(\d{1,2})\.(\d{1,2})\.(\d{4})\b/i);
  if(!m)return '';
  const iso=m[3]+'-'+m[2].padStart(2,'0')+'-'+m[1].padStart(2,'0');
  const date=new Date(iso+'T12:00:00Z');
  return !Number.isNaN(date.getTime())&&date.toISOString().slice(0,10)===iso?iso:'';
}

export function detectReferences(page,heading){
  const text=page.rows.map(rowText).join('\n');
  const rapport=text.match(/\bRapport[\s\-–]*(?:Nr\.?|nummer)\s*:?\s*(\d{3,10})\b/i)?.[1]||'';
  const delivery=text.match(/\bLieferschein[\s\-–]*(?:Nr\.?|nummer)\s*:?\s*(\d{3,10})\b/i)?.[1]||'';
  const customerNo=text.match(/\bKunden[\s\-–]*(?:nummer|Nr\.?)\s*:?\s*(\d+)\b/i)?.[1]||'';
  const report=rapport||delivery||heading?.number||'';
  const referenceConflict=Boolean(heading?.number&&report&&heading.number!==report);
  const machine=(text.match(/^Maschine\s*:?\s*(.+)$/im)?.[1]||'').split(/\s+Kontrollschild\s*:/i)[0].trim();
  return {report,customerNo,machine,referenceConflict,referenceType:rapport?'Rapport-Nr.':delivery?'Lieferschein-Nr.':'Dokumentnummer'};
}

// ERP descriptions can wrap before "inkl. MwSt.", with numeric article columns in between.
export function detectPremium(lines){
  let gross=0, found=0, unresolved=0;
  for(let i=0;i<lines.length;i++){
    const line=normalize(lines[i]);
    const marker=line.match(/\bEintausch\s*prämie\b/i);
    if(!marker)continue;
    found++;
    const tail=line.slice(marker.index+marker[0].length);
    const next=normalize(lines[i+1]||'');
    const following=normalize(lines[i+2]||'');
    const amount=tail.match(/\(\s*(?:CHF\s*|Fr\.\s*)?(\d+(?:[’' ]\d{3})*(?:[.,]\d{2})?)(?:\s*[.,]\s*[-–—])?(?=\s|[)]|$)/i);
    const ownInclusive=amount && /^\s*inkl\.?\s*(?:MwSt\.?)?/i.test(tail.slice(amount.index+amount[0].length));
    const nextInclusive=/^inkl\.?(?:\s|$)/i.test(next);
    const splitAmount= !amount && /^\s*\(\s*$/.test(tail) && next.match(/^(?:CHF\s*|Fr\.\s*)?(\d+(?:[’' ]\d{3})*(?:[.,]\d{2})?)(?:\s*[.,]\s*[-–—])?(?=\s|[)]|$)/i);
    let value=null;
    if(!amount && !tail.trim()){
      const m=next.match(/^\(\s*(?:CHF\s*|Fr\.\s*)?(\d+(?:[’' ]\d{3})*(?:[.,]\d{2})?)(?:\s*[.,]\s*[-–—])?\s*inkl\.?(?=\s|\)|$)/i);
      if(m)value=m[1];
      else if(/^\(/.test(next)&&/^inkl\.?(?:\s|$)/i.test(following)){
        const split=next.match(/^\(\s*(?:CHF\s*|Fr\.\s*)?(\d+(?:[’' ]\d{3})*(?:[.,]\d{2})?)(?:\s*[.,]\s*[-–—])?\s*$/i);
        if(split)value=split[1];
      }
    }
    if(amount&&(ownInclusive||nextInclusive))value=amount[1];
    if(splitAmount&&(/^\s*inkl\.?(?:\s|$)/i.test(next.slice(splitAmount[0].length))||/^inkl\.?(?:\s|$)/i.test(following)))value=splitAmount[1];
    try{const cents=value===null?0:parseMoney(value);if(cents>0){gross+=cents;}else{unresolved++;}}catch{unresolved++;}
  }
  return {gross,found,unresolved};
}

export async function analyzePdf(bytes) {
  const lib=await getPdfJs();
  const source = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  const doc=await lib.getDocument({data:source.slice()}).promise;
  const pages=[];
  for (let p=1;p<=doc.numPages;p++) {
    const page=await doc.getPage(p);
    const text=await page.getTextContent();
    const rows=makeRows(text.items);
    pages.push({page,items:text.items,rows,width:page.view[2]-page.view[0],height:page.view[3]-page.view[1]});
  }
  const documentTitle=detectDocumentTitle(pages[0]);
  const existingDate=originalInvoiceDate(pages[0],documentTitle);
  const allLines=pages.flatMap(p=>p.rows.map(rowText));
  const whole=allLines.join('\n');
  const refs=detectReferences(pages[0],documentTitle);
  const summaryCandidates=pages.map(p=>parseSummary(p.rows));
  const summaryIdx=summaryCandidates.findLastIndex(Boolean);
  const summary=summaryCandidates[summaryIdx];
  const rates=[...new Set([...whole.matchAll(/MwSt\s*(\d{1,2}(?:[.,]\d{1,2})?)\s*%/gi)].map(m=>parseVatBps(m[1])))];
  // Empfänger oben rechts im ERP-Layout, bewusst als Vorschlag editierbar.
  const upperRight=pages[0].items.filter(i=>i.transform[4]>pages[0].width*.48 && i.transform[5]>pages[0].height*.76)
    .sort((a,b)=>b.transform[5]-a.transform[5]);
  const customer=normalize(upperRight.find(i=>!/^Sutz[,\s]/i.test(normalize(i.str)))?.str??'');
  const standaloneTrade=allLines.some(s=>/^Eintausch\b(?!prämie)/i.test(s) && !/^Eintauschprämie/i.test(s));
  const premium=detectPremium(allLines);
  const premiumGross=premium.gross;
  return {doc,pages,documentTitle,documentType:documentTitle?.type??'',existingDate,...refs,customer,
    summaryIdx,summary,rates,standaloneTrade,premiumGross,premiumFound:premium.found,premiumUnresolved:premium.unresolved,rawText:whole,byteLength:source.length};
}
function putText(ctx,x,y,label,fontSize,color='#161616',align='left') {
  ctx.fillStyle=color; ctx.textAlign=align; ctx.textBaseline='alphabetic';
  ctx.font=`${fontSize}px Arial, Helvetica, sans-serif`;
  ctx.fillText(label,x,y);ctx.textAlign='left';
}
function paintTitle(ctx,analysis,scale,invoiceNumber,date) {
  const {items,width,height}=analysis.pages[0];
  const heading=analysis.documentTitle??detectDocumentTitle(analysis.pages[0]);
  if(!heading) throw new Error('Kein eindeutiger ERP-Dokumenttitel erkannt. Unterstützt: Proformarechnung, Kostenvoranschlag, Lieferschein und Rechnung.');
  const title=heading.item;
  const x=title.transform[4]*scale,base=(height-title.transform[5])*scale;
  const font=Math.max(10,(title.height||13)*scale);
  const dateItems=items.filter(i=>i.transform[4]>width*.48&&Math.abs(i.transform[5]-title.transform[5])<5&&/^Sutz\s*,/i.test(normalize(i.str)));
  if(!dateItems.length) throw new Error('Datumsposition «Sutz,» neben dem Dokumenttitel nicht gefunden.');
  const d=dateItems[0],dx=d.transform[4]*scale,dy=(height-d.transform[5])*scale;
  const label='Rechnung Nr. '+invoiceNumber;
  ctx.font=font+'px Arial, Helvetica, sans-serif';
  const titleEnd=Math.max(...heading.items.map(i=>(i.transform[4]+(i.width||0))*scale));
  const right=Math.max(titleEnd+3*scale,x+ctx.measureText(label).width+3*scale);
  if(right>dx-5*scale)throw new Error('Rechnungstitel hat nicht genügend Platz neben dem Datum.');
  ctx.fillStyle='#fff';ctx.fillRect(x-3*scale,base-font*1.30,right-x+3*scale,font*1.65);
  putText(ctx,x,base,label,font);
  const df=Math.max(9,(d.height||11)*scale);
  ctx.fillStyle='#fff';ctx.fillRect(dx-3*scale,dy-df*1.3,width*scale-dx-12*scale,df*1.65);
  putText(ctx,dx,dy,'Sutz, '+chDate(date),df);
}
function paintSummary(ctx,analysis,scale,calc) {
  const {summary}=analysis;
  if(!summary) throw new Error('Die Originalsumme wurde nicht eindeutig erkannt.');
  const page=analysis.pages[analysis.summaryIdx];
  const right=(page.width-35)*scale;
  const fields=[['rowSum','Summe',calc.net],['rowVat',`MwSt ${(calc.vatBps/100).toFixed(2)}%`,calc.vat],['rowTotal','Total',calc.total]];
  for(const [key,label,amount] of fields){
    const row=summary[key],base=(page.height-row.y)*scale;
    const lx=row.items[0].transform[4]*scale;
    const font=Math.max(9,(row.items[0].height||10)*scale);
    ctx.fillStyle='#fff';ctx.fillRect(lx-3*scale,base-font*1.28,page.width*scale-lx-10*scale,font*1.6);
    putText(ctx,lx,base,label,font);
    putText(ctx,right,base,formatMoney(amount,'Fr. '),font,'#161616','right');
  }
}
export function findTradeSlot(analysis) {
  const idx=analysis.summaryIdx, summaryPage=analysis.pages[idx], sumY=analysis.summary.rowSum.y;
  const priced=row=>row.items.some(i=>i.transform[4]>summaryPage.width*.72&&/^-?\d[\d’',.]*[.,]\d{2}$/.test(normalize(i.str))) &&
    row.items.some(i=>i.transform[4]<summaryPage.width*.48 && normalize(i.str));
  const hasArticles=summaryPage.rows.some(r=>r.y>sumY+3&&priced(r));
  let pageIndex=idx, p=summaryPage, boundary=sumY;
  if(!hasArticles && idx>0){
    pageIndex=idx-1;p=analysis.pages[pageIndex];
    const foot=p.rows.find(r=>/Seite\s*\d+\s*von\s*\d+/i.test(rowText(r)));
    boundary=foot?.y??35;
  }
  const articleRows=p.rows.filter(r=>r.y>boundary+3);
  const last=articleRows.at(-1);
  if(!last)throw new Error('Keine Artikelposition vor der Summenzeile erkannt.');
  const rowY=last.y-14;
  if(rowY-boundary<11)throw new Error('Für die zusätzliche Eintauschposition fehlt Platz zwischen Artikeln und Total. Bitte Vorlage prüfen.');
  const priceRow=articleRows.findLast(priced);
  const amounts=priceRow?.items.filter(i=>i.transform[4]>p.width*.58&&/^-?\d[\d’',.]*[.,]\d{2}$/.test(normalize(i.str)))||[];
  const ends=amounts.map(i=>i.transform[4]+(i.width||0)).sort((a,b)=>a-b);
  const qty=priceRow?.items.find(i=>/^\d+(?:[.,]\d+)?\s*(?:Stk\.?|Std\.?|h|m)$/i.test(normalize(i.str)));
  return {pageIndex,rowY,left:Math.min(...last.items.map(i=>i.transform[4])),qty:qty?.transform[4]??p.width*.51,unitRight:ends.length>=2?ends[0]:p.width*.695,totalRight:ends.at(-1)??p.width*.89};
}
function paintTradeRow(ctx,analysis,scale,discountNet,slot) {
  const p=analysis.pages[slot.pageIndex],base=(p.height-slot.rowY)*scale,font=9*scale;
  putText(ctx,Math.max(40,slot.left)*scale,base,'Eintausch',font);
  putText(ctx,slot.qty*scale,base,'1 Stk.',font);
  putText(ctx,slot.unitRight*scale,base,formatMoney(-discountNet,''),font,'#161616','right');
  putText(ctx,slot.totalRight*scale,base,formatMoney(-discountNet,''),font,'#161616','right');
}
export async function renderInvoicePdf(analysis,opts) {
  const {PDFDocument}=window.PDFLib??{};
  if(!PDFDocument) throw new Error('PDF-Bibliothek nicht geladen. Bitte Seite neu laden.');
  if(!analysis.documentTitle&&!detectDocumentTitle(analysis.pages[0])) throw new Error('ERP-Dokumenttyp nicht erkannt. Proformarechnung, Kostenvoranschlag, Lieferschein oder Rechnung erforderlich.');
  if(analysis.referenceConflict) throw new Error('Dokumentnummer und Referenznummer stimmen nicht überein.');
  if(!analysis.report || opts.number!==analysis.report || !/^\d+$/.test(opts.number)) throw new Error('Rechnungs-/Rapportnummer fehlt.');
  if(!analysis.summary) throw new Error('Originalsummen konnten nicht sicher ausgelesen werden.');
  if (opts.tradeGross>0 && analysis.standaloneTrade && !opts.confirmExtra) throw new Error('Eine eigenständige Eintauschposition ist bereits vorhanden. Es wird kein weiterer Abzug eingefügt.');
  if(opts.tradeGross>0 && analysis.rates.length>1) throw new Error('Mehrere MwSt-Sätze gefunden: Eintausch muss steuerlich manuell zugeordnet werden.');
  const calc=recalculate({...analysis.summary,tradeGross:opts.tradeGross,vatBps:analysis.summary.vatBps});
  if(!sourceRoundingAllowed(calc)) throw new Error(`Originalsummen weichen um ${formatMoney(calc.sourceDifference)} ab (über CHF 0.05). Bitte ERP-Export prüfen.`);
  const tradeSlot=opts.tradeGross>0?findTradeSlot(analysis):null;
  const doc=await PDFDocument.create();
  for(let i=0;i<analysis.pages.length;i++){
    const p=analysis.pages[i],scale=3.5; // ca. 252 dpi; Originalseiten bleiben im Erscheinungsbild erhalten.
    const viewport=p.page.getViewport({scale});
    const canvas=document.createElement('canvas');canvas.width=Math.ceil(viewport.width);canvas.height=Math.ceil(viewport.height);
    const ctx=canvas.getContext('2d',{alpha:false});ctx.fillStyle='#fff';ctx.fillRect(0,0,canvas.width,canvas.height);
    await p.page.render({canvasContext:ctx,viewport}).promise;
    if(i===0) paintTitle(ctx,analysis,scale,opts.number,opts.date);
    if(tradeSlot && i===tradeSlot.pageIndex) paintTradeRow(ctx,analysis,scale,calc.discountNet,tradeSlot);
    if(opts.tradeGross>0 && i===analysis.summaryIdx) paintSummary(ctx,analysis,scale,{...calc,vatBps:analysis.summary.vatBps});
    const blob=await new Promise((resolve,reject)=>canvas.toBlob(x=>x?resolve(x):reject(new Error('PNG-Export fehlgeschlagen.')),'image/png'));
    const data=await blob.arrayBuffer();
    const img=await doc.embedPng(data); const out=doc.addPage([p.width,p.height]);out.drawImage(img,{x:0,y:0,width:p.width,height:p.height});
    canvas.width=1;canvas.height=1;
  }
  doc.setTitle(`Rechnung Nr. ${opts.number}`);
  doc.setAuthor('Lehmann Gerätetechnik GmbH');
  doc.setSubject('Rechnung');
  return {bytes:await doc.save(),calc};
}
export function invoiceFilename(number,customer) {
  const clean=(customer||'Kunde').trim().split(/\s+/).at(-1).normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^A-Za-z0-9_-]/g,'');
  return `Rechnung_${number}_${clean||'Kunde'}.pdf`;
}