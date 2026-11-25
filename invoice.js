import { parseMoney, parseVatBps, recalculate, formatMoney, chDate } from './money.js';
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
function makeRows(items) {
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
function parseSummary(rows) {
  const entries = rows.map(r=>({row:r,text:rowText(r)}));
  const take=(re)=>entries.find(e=>re.test(e.text));
  const sum=take(/^Summe\b/i), vat=take(/^MwSt\b/i), total=take(/^Total\b/i);
  if (!sum||!vat||!total) return null;
  const bpsMatch=vat.text.match(/MwSt\s*(\d{1,2}[.,]\d{1,2})\s*%/i);
  if(!bpsMatch) return null;
  try {
    const originalNet=lineAmount(sum.text), originalVat=lineAmount(vat.text), originalTotal=lineAmount(total.text);
    if ([originalNet,originalVat,originalTotal].some(n=>n===null)) return null;
    return {originalNet,originalVat,originalTotal,vatBps:parseVatBps(bpsMatch[1]),
      rowSum:sum.row,rowVat:vat.row,rowTotal:total.row};
  } catch {return null;}
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
  const allLines=pages.flatMap(p=>p.rows.map(rowText));
  const whole=allLines.join('\n');
  const matchReport=whole.match(/Rapport[\s-]*Nr\.?\s*:?\s*(\d{3,10})/i);
  const report=matchReport?.[1]??'';
  const matchCustomerNo=whole.match(/Kundennummer\s*:?\s*(\d+)/i);
  const machine=whole.match(/^Maschine\s*:?\s*(.*)$/im)?.[1]??'';
  const summaryCandidates=pages.map(p=>parseSummary(p.rows));
  const summaryIdx=summaryCandidates.findLastIndex(Boolean);
  const summary=summaryCandidates[summaryIdx];
  const rates=[...new Set([...whole.matchAll(/MwSt\s*(\d{1,2}(?:[.,]\d{1,2})?)\s*%/gi)].map(m=>parseVatBps(m[1])))];
  // Empfänger oben rechts im ERP-Layout, bewusst als Vorschlag editierbar.
  const upperRight=pages[0].items.filter(i=>i.transform[4]>pages[0].width*.48 && i.transform[5]>pages[0].height*.76)
    .sort((a,b)=>b.transform[5]-a.transform[5]);
  const customer=normalize(upperRight.find(i=>!/^Sutz[,\s]/i.test(normalize(i.str)))?.str??'');
  const standaloneTrade=allLines.some(s=>/^Eintausch\b(?!prämie)/i.test(s) && !/^Eintauschprämie/i.test(s));
  const premiumLine=allLines.find(s=>/Eintauschprämie/i.test(s))??'';
  const grossMatch=premiumLine.match(/\(\s*(\d[\d’' ]*(?:[.,]\d{2})?)\s*[.,-]*\s*inkl\.?/i);
  let premiumGross=0;
  if(grossMatch){try {premiumGross=parseMoney(grossMatch[1]);}catch {}}
  return {doc,pages,report,customer,customerNo:matchCustomerNo?.[1]??'',machine,
    summaryIdx,summary,rates,standaloneTrade,premiumGross,rawText:whole,byteLength:source.length};
}
function putText(ctx,x,y,label,fontSize,color='#161616',align='left') {
  ctx.fillStyle=color; ctx.textAlign=align; ctx.textBaseline='alphabetic';
  ctx.font=`${fontSize}px Arial, Helvetica, sans-serif`;
  ctx.fillText(label,x,y);ctx.textAlign='left';
}
function paintTitle(ctx,analysis,scale,invoiceNumber,date) {
  const {items,width,height}=analysis.pages[0];
  const title=items.find(i=>/\bProformarechnung\b/i.test(i.str));
  if(!title) throw new Error('Der Titel «Proformarechnung» wurde nicht gefunden. Diese Vorlage muss zuerst geprüft werden.');
  const x=title.transform[4]*scale,base=(height-title.transform[5])*scale;
  const font=Math.max(10,(title.height||13)*scale);
  ctx.fillStyle='#fff';ctx.fillRect(x-3*scale,base-font*1.30,Math.min(width*scale-x-3*scale,310*scale),font*1.65);
  putText(ctx,x,base,`Rechnung Nr. ${invoiceNumber}`,font);
  const dateItems=items.filter(i=>/\bSutz\s*,/i.test(i.str));
  if(!dateItems.length) throw new Error('Datumsposition «Sutz,» nicht gefunden.');
  const d=dateItems[0],dx=d.transform[4]*scale,dy=(height-d.transform[5])*scale;
  const df=Math.max(9,(d.height||11)*scale);
  ctx.fillStyle='#fff';ctx.fillRect(dx-3*scale,dy-df*1.3,width*scale-dx-12*scale,df*1.65);
  putText(ctx,dx,dy,`Sutz, ${chDate(date)}`,df);
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
function paintTradeRow(ctx,analysis,scale,discountNet) {
  // Konservativ: nur freie Zeile unter letzter Position und vor ERP-Seitenfuss verwenden.
  const summaryIdx=analysis.summaryIdx;
  const idx=summaryIdx>0?summaryIdx-1:summaryIdx;
  const p=analysis.pages[idx];
  const filtered=p.items.filter(i=>i.transform[5]>35 && i.transform[5]<p.height*.70 &&
    !/Seite\s*\d+\s*von\s*\d+/i.test(i.str) &&
    !/^(Summe|MwSt|Total)\b/i.test(normalize(i.str)));
  const lastY=Math.min(...filtered.map(i=>i.transform[5]));
  const foot=p.items.find(i=>/Seite\s*\d+\s*von\s*\d+/i.test(i.str));
  const footerY=foot?.transform[5]??35;
  if(!Number.isFinite(lastY) || lastY-footerY<34) {
    throw new Error('Für eine zusätzliche Eintauschposition ist kein sicherer Platz erkennbar. Kein PDF erzeugt – Vorlage manuell prüfen.');
  }
  const rowY=lastY-18;
  const base=(p.height-rowY)*scale;
  const font=10*scale;
  ctx.fillStyle='#fff';ctx.fillRect(40*scale,base-12*scale,(p.width-65)*scale,16*scale);
  putText(ctx,50*scale,base,'Eintausch',font);
  putText(ctx,p.width*.57*scale,base,'1 Stk.',font);
  putText(ctx,p.width*.79*scale,base,formatMoney(-discountNet,''),font,'#161616','right');
  putText(ctx,(p.width-35)*scale,base,formatMoney(-discountNet,''),font,'#161616','right');
  return idx;
}
export async function renderInvoicePdf(analysis,opts) {
  const {PDFDocument}=window.PDFLib??{};
  if(!PDFDocument) throw new Error('PDF-Bibliothek nicht geladen. Bitte Seite neu laden.');
  if(!analysis.report || !/^\d+$/.test(opts.number)) throw new Error('Rechnungs-/Rapportnummer fehlt.');
  if(!analysis.summary) throw new Error('Originalsummen konnten nicht sicher ausgelesen werden.');
  if (opts.tradeGross>0 && analysis.standaloneTrade && !opts.confirmExtra) throw new Error('Eine eigenständige Eintauschposition ist bereits vorhanden. Es wird kein weiterer Abzug eingefügt.');
  if(opts.tradeGross>0 && analysis.rates.length>1) throw new Error('Mehrere MwSt-Sätze gefunden: Eintausch muss steuerlich manuell zugeordnet werden.');
  const calc=recalculate({...analysis.summary,tradeGross:opts.tradeGross,vatBps:analysis.summary.vatBps});
  if(Math.abs(calc.roundingDifference)>1) throw new Error(`Rundungsdifferenz beim Eintausch (${formatMoney(calc.roundingDifference)}) ist zu hoch. PDF-Ausgabe gesperrt.`);
  if(calc.sourceDifference!==0) throw new Error(`Originalsummen sind um ${formatMoney(calc.sourceDifference)} widersprüchlich. PDF-Ausgabe gesperrt.`);
  const doc=await PDFDocument.create();
  for(let i=0;i<analysis.pages.length;i++){
    const p=analysis.pages[i],scale=3.5; // ca. 252 dpi; Originalseiten bleiben im Erscheinungsbild erhalten.
    const viewport=p.page.getViewport({scale});
    const canvas=document.createElement('canvas');canvas.width=Math.ceil(viewport.width);canvas.height=Math.ceil(viewport.height);
    const ctx=canvas.getContext('2d',{alpha:false});ctx.fillStyle='#fff';ctx.fillRect(0,0,canvas.width,canvas.height);
    await p.page.render({canvasContext:ctx,viewport}).promise;
    if(i===0) paintTitle(ctx,analysis,scale,opts.number,opts.date);
    if(opts.tradeGross>0) {
      const idx=analysis.summaryIdx>0?analysis.summaryIdx-1:analysis.summaryIdx;
      if(i===idx) paintTradeRow(ctx,analysis,scale,calc.discountNet);
    }
    if(i===analysis.summaryIdx) paintSummary(ctx,analysis,scale,{...calc,vatBps:analysis.summary.vatBps});
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