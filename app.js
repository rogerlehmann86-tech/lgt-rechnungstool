import { swissDate, chDate, parseMoney, formatMoney, recalculate } from './money.js';
import { analyzePdf, renderInvoicePdf, invoiceFilename } from './invoice.js';

const cfg=window.LGT_CONFIG||{};
let supabase=null, user=null, authorized=false, invoices=[],claims=[];
let view='dashboard', analysis=null, sourceBytes=null, issued=null, pdfUrl=null;
const $=s=>document.querySelector(s);
const screen=$('#screen');
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const amt=n=>formatMoney(n??0);
const displayDate=s=>chDate(s)||'—';
const connected=()=>Boolean(supabase&&user&&authorized);
function alertBox(msg,tone='info'){
  const b=$('#banner');b.className=`notice ${tone}`;b.textContent=msg;b.classList.remove('hidden');
}
function clearAlert(){$('#banner').classList.add('hidden');}
function setBusy(button,on,caption='Verarbeiten …'){
  if(!button)return; if(on){button.dataset.prevText=button.textContent;button.textContent=caption;button.disabled=true;} else {button.textContent=button.dataset.prevText||button.textContent;button.disabled=false;}
}
function status(s){return ({open:'Offen',claimed:'Eingefordert',partial:'Teilzahlung',paid:'Erhalten'})[s]||'Offen';}
function statusClass(s){return ({open:'neutral',claimed:'warning',partial:'warning',paid:'success'})[s]||'neutral';}
function nav(next){view=next;document.querySelectorAll('[data-view]').forEach(b=>b.classList.toggle('active',b.classList.contains('nav-item')&&b.dataset.view===next));
  $('#page-title').textContent=({dashboard:'Übersicht',create:'Neue Rechnung',invoices:'Rechnungsarchiv',claims:'Husqvarna-Prämien'})[next]||next;
  render();window.scrollTo({top:0,behavior:'smooth'});
}
async function initialize(){
  if(cfg.supabaseUrl&&cfg.publishableKey){
    try{
      const {createClient}=await import('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.119.2/+esm');
      supabase=createClient(cfg.supabaseUrl,cfg.publishableKey);
      const {data,error}=await supabase.auth.getUser();
      if(error) throw error;
      user=data.user;
      await loadStaffAndRecords();
      supabase.auth.onAuthStateChange((_event,s)=>{if(s?.user?.id!==user?.id){user=s?.user??null;authorized=false;invoices=[];claims=[];setTimeout(()=>{loadStaffAndRecords().then(render).catch(console.error);},0);}});
    }catch(error){console.error(error);alertBox(`Supabase konnte nicht verbunden werden: ${error.message}`,'error');}
  }
  render();
}
async function loadStaffAndRecords(){
  authorized=false;
  if(!supabase||!user){updateHeader();return;}
  const {data,error}=await supabase.from('lgt_staff').select('user_id').eq('user_id',user.id).eq('active',true).maybeSingle();
  if(error){alertBox(`Zugriffsprüfung fehlgeschlagen: ${error.message}`,'error');return;}
  authorized=Boolean(data);
  if(authorized)await reloadRecords();
  updateHeader();
}
function updateHeader(){
  $('#user-label').textContent=user?.email||'';
  $('#logout-btn').classList.toggle('hidden',!user);
  $('#connection-label').textContent=connected()?'Geschützte Datenbank aktiv':cfg.supabaseUrl?'Nicht angemeldet':'Datenbank noch nicht eingerichtet';
  $('.status-dot').classList.toggle('online',connected());
}
async function reloadRecords(){
  if(!connected())return;
  const [a,b]=await Promise.all([
    supabase.from('lgt_invoices').select('*').order('created_at',{ascending:false}).limit(1000),
    supabase.from('lgt_claims').select('*').order('created_at',{ascending:false}).limit(1000)]);
  if(a.error||b.error)throw new Error(a.error?.message||b.error?.message);
  invoices=a.data||[];claims=b.data||[];
}
function render(){updateHeader();
  if(cfg.supabaseUrl&&(!user||!authorized)) {renderLogin();return;}
  if(view==='create')return renderCreate();
  if(view==='claims')return renderClaims();
  if(view==='invoices')return renderInvoices();
  renderDashboard();
}
function empty(text){return `<div class="empty"><div class="empty-icon">▣</div><strong>${esc(text)}</strong><p>Hier erscheinen deine Einträge nach dem Speichern.</p></div>`;}
function renderLogin(){
  if(user&&!authorized){screen.innerHTML=`<div class="panel centered"><h2>Zugriff noch nicht freigeschaltet</h2><p>${esc(user.email)} ist angemeldet, aber noch nicht in <code>lgt_staff</code> hinterlegt. Ein Administrator muss diesen Benutzer freischalten.</p><button id="auth-signout" class="btn ghost">Abmelden</button></div>`;return;}
  screen.innerHTML=`<div class="panel login-card"><p class="eyebrow">Geschützter Bereich</p><h2>Bei LGT anmelden</h2><p>Rechnungen und Kundenangaben sind nur für freigeschaltete Mitarbeitende sichtbar.</p><form id="login-form" class="form-stack"><label>E-Mail<input name="email" type="email" autocomplete="email" required placeholder="name@lehmann-gt.ch"></label><label>Passwort<input name="password" type="password" autocomplete="current-password" required minlength="6"></label><button class="btn primary" type="submit">Anmelden</button></form></div>`;
}
function stats(){const outstanding=claims.reduce((a,c)=>a+Math.max(0,(c.claimed_amount_cents||0)-(c.received_amount_cents||0)),0);
  return [{n:invoices.length,l:'Erstellte Rechnungen',s:'Im Archiv erfasst'},{n:claims.filter(c=>c.status==='open').length,l:'Offene Prämien',s:'Noch nicht eingefordert'},{n:amt(outstanding),l:'Ausstehender Betrag',s:'Husqvarna-Rückvergütungen'},{n:claims.filter(c=>c.status==='paid').length,l:'Erhaltene Prämien',s:'Abgeschlossene Fälle'}];}
function invoiceTable(items){
  if(!items.length)return empty('Noch keine Rechnungen vorhanden');
  return `<div class="table-scroll"><table><thead><tr><th>Rechnung</th><th>Kunde / Maschine</th><th>Datum</th><th class="right">Total</th><th>Prämie</th><th>PDF</th></tr></thead><tbody>${items.map(i=>{
    const c=claims.find(c=>c.invoice_id===i.id);return `<tr><td><strong>#${esc(i.number)}</strong><small>Rapport ${esc(i.number)}</small></td><td><strong>${esc(i.customer_name)}</strong><small>${esc(i.machine||'—')}</small></td><td>${displayDate(i.invoice_date)}</td><td class="right numeric">${amt(i.total_cents)}</td><td>${c?`<span class="pill ${statusClass(c.status)}">${status(c.status)}</span>`:'—'}</td><td><button class="text-btn" data-download="${esc(i.id)}" ${i.files_ready?'':'disabled title="Dateien unvollständig"'}>PDF laden</button></td></tr>`;
  }).join('')}</tbody></table></div>`;
}
function renderDashboard(){
  const s=stats();screen.innerHTML=`<div class="intro"><div><h2>Alle Rechnungen im Blick</h2><p>Rechnungen erstellen, archivieren und Husqvarna-Prämien kontrollieren.</p></div><button class="btn secondary" data-view="claims">Prämien verwalten</button></div>
    <div class="stats">${s.map(x=>`<article class="stat"><div class="stat-value">${esc(x.n)}</div><strong>${esc(x.l)}</strong><p>${esc(x.s)}</p></article>`).join('')}</div>
    <div class="panel"><div class="panel-head"><div><h2>Letzte Rechnungen</h2><p>Zuletzt erfasste Belege</p></div><button class="text-btn" data-view="invoices">Alle anzeigen</button></div>${invoiceTable(invoices.slice(0,8))}</div>
    ${!cfg.supabaseUrl?`<div class="notice warning"><strong>Einrichtung ausstehend:</strong> Das Tool kann PDFs lokal bearbeiten. Rechnungsarchiv und Prämienstatus werden erst gespeichert, wenn Supabase eingerichtet ist.</div>`:''}`;
}
function renderInvoices(){screen.innerHTML=`<div class="panel"><div class="panel-head"><div><h2>Rechnungsarchiv</h2><p>Einmalige Rapportnummer = Rechnungsnummer. Original und definitive PDF-Datei werden geschützt abgelegt.</p></div><label class="search"><span>⌕</span><input id="invoice-search" placeholder="Nummer, Kunde, Maschine suchen" aria-label="Rechnungen durchsuchen"></label></div><div id="invoice-results">${invoiceTable(invoices)}</div></div>`;}
function renderClaims(){
  const outstanding=claims.filter(c=>c.status!=='paid');
  screen.innerHTML=`<div class="intro"><div><h2>Husqvarna-Eintauschprämien</h2><p>Vom Kundenrabatt getrennt: Einforderung und effektiver Zahlungseingang.</p></div><div class="amount-large">${amt(outstanding.reduce((a,c)=>a+Math.max(0,(c.claimed_amount_cents||0)-(c.received_amount_cents||0)),0))}<small>Noch offen</small></div></div>
    <div class="panel"><div class="panel-head"><div><h2>Prämienübersicht</h2><p>Einfordern → Zahlung erfassen → abschliessen</p></div><select id="claim-filter"><option value="all">Alle Status</option><option value="open">Offen</option><option value="claimed">Eingefordert</option><option value="partial">Teilzahlung</option><option value="paid">Erhalten</option></select></div><div id="claim-results">${claimTable(claims)}</div></div>`;
}
function claimTable(records){
  if(!records.length)return empty('Noch keine Husqvarna-Prämien erfasst');
  return `<div class="table-scroll"><table><thead><tr><th>Rechnung / Kunde</th><th class="right">Prämie</th><th class="right">Erhalten</th><th>Datum eingefordert</th><th>Status</th><th>Aktion</th></tr></thead><tbody>${records.map(c=>{
    const i=invoices.find(x=>x.id===c.invoice_id);
    return `<tr><td><strong>#${esc(i?.number||'—')}</strong><small>${esc(i?.customer_name||'—')}</small></td><td class="right numeric">${amt(c.claimed_amount_cents)}</td><td class="right numeric">${amt(c.received_amount_cents||0)}</td><td>${displayDate(c.claimed_on)}</td><td><span class="pill ${statusClass(c.status)}">${status(c.status)}</span></td><td>${c.status==='open'?`<button class="btn small secondary" data-claim-request="${c.id}">Einforderung erfassen</button>`:c.status==='paid'?`<button class="text-btn" data-claim-history="${c.id}">Verlauf</button>`:`<button class="btn small secondary" data-claim-paid="${c.id}">Zahlung erfassen</button> <button class="text-btn" data-claim-history="${c.id}">Verlauf</button>`}</td></tr>`;
  }).join('')}</tbody></table></div>`;
}
function renderCreate(){
  const analyzed=Boolean(analysis);
  screen.innerHTML=`<div class="step-grid"><div class="panel editor"><div class="section-title"><span class="step">1</span><div><h2>ERP-Proformarechnung hochladen</h2><p>Die Datei bleibt bis zum Speichern auf deinem Gerät.</p></div></div><label class="dropzone"><input type="file" id="pdf-file" accept="application/pdf,.pdf"><span class="upload-icon">↑</span><strong>PDF auswählen</strong><small>Originalexport aus deinem ERP – keine Scans</small></label>
    <div id="editor-fields">${analyzed?createFields():`<div class="empty compact">Nach dem Hochladen werden die erkannten Rechnungsangaben hier angezeigt.</div>`}</div></div>
    <div class="panel preview-panel"><div class="section-title"><span class="step">2</span><div><h2>Rechnung kontrollieren</h2><p>Nach Berechnung eine Vorschau erstellen und visuell prüfen.</p></div></div>
    <div id="calc-panel">${analyzed?renderCalculation():`<div class="preview-placeholder">PDF-Vorschau erscheint hier.</div>`}</div>
    <div id="pdf-viewer">${issued?`<iframe title="Rechnungsvorschau" src="${pdfUrl}"></iframe>`:''}</div>
    <div class="action-stack" id="generate-actions">${analyzed?generateActions():''}</div></div></div>`;
}
function createFields(){
  const s=analysis.summary;
  return `<div class="divider"></div><div class="form-grid"><label>Rechnungsnummer (= Rapport)<input id="invoice-number" value="${esc(analysis.report)}" readonly></label><label>Rechnungsdatum<input id="invoice-date" type="date" value="${swissDate()}" required></label>
    <label class="full">Kundenname <small>(bitte prüfen)</small><input id="customer-name" value="${esc(analysis.customer)}" placeholder="Vorname Nachname" required></label>
    <label>Kundennummer<input id="customer-number" value="${esc(analysis.customerNo)}"></label><label>Mehrwertsteuer<input value="${s?(s.vatBps/100).toFixed(2)+'%':'Nicht erkannt'}" disabled></label>
    <label class="full">Maschine<input id="machine" value="${esc(analysis.machine)}"></label>
  </div><div class="divider"></div><h3>Eintausch und Herstellerprämie</h3>
  ${analysis.standaloneTrade?`<div class="notice warning">Im ERP ist bereits eine eigenständige <strong>Eintausch</strong>-Position enthalten. Ein zusätzlicher Abzug ist standardmässig gesperrt.</div>`:''}
  <label class="toggle"><input type="checkbox" id="contained" ${analysis.standaloneTrade?'checked':''}><span>Nur Rechnung / Eintausch bereits enthalten (kein zusätzlicher Abzug)</span></label>
  <div class="form-grid"><label>Zusätzlicher Eintausch inkl. MwSt. (CHF)<input id="trade-gross" inputmode="decimal" value="0.00" ${analysis.standaloneTrade?'disabled':''}></label><label>Husqvarna-Prämie (CHF inkl. MwSt.)<input id="premium-gross" inputmode="decimal" value="${(analysis.premiumGross/100).toFixed(2)}"><small>Separater Rückforderungsbetrag, nicht nochmals abziehen</small></label></div>
  <p class="helper">Artikel, Preise und Rabatte des ERP-Exports bleiben unverändert. Ein zusätzlicher Eintausch wird nur nach erfolgreicher Platz- und Summenprüfung eingefügt.</p>`;
}
function formTrade(){if($('#contained')?.checked)return 0;return parseMoney($('#trade-gross')?.value||'0.00');}
function getCalculation(){if(!analysis?.summary)throw new Error('Originalsummen fehlen.');
  const tradeGross=formTrade();
  if(tradeGross>0&&analysis.standaloneTrade)throw new Error('Bereits vorhandener Eintausch: zusätzlicher Abzug nicht freigegeben.');
  if(tradeGross>0&&analysis.rates.length>1)throw new Error('Mehrere MwSt-Sätze: steuerliche Zuordnung erforderlich.');
  return {...recalculate({...analysis.summary,tradeGross,vatBps:analysis.summary.vatBps}),tradeGross};
}
function renderCalculation(){
  if(!analysis.summary)return `<div class="notice error">Summen des ERP-PDFs nicht erkannt. Keine automatische Freigabe möglich.</div>`;
  let calc;try{calc=getCalculation();}catch(error){return `<div class="notice warning">${esc(error.message)}</div>`;}
  return `<div class="calculation"><div><span>Ursprüngliches Total</span><strong>${amt(analysis.summary.originalTotal)}</strong></div><div><span>Zusätzlicher Eintausch brutto</span><strong>${amt(calc.tradeGross)}</strong></div><div><span>Neue Nettosumme</span><strong>${amt(calc.net)}</strong></div><div><span>MwSt ${(analysis.summary.vatBps/100).toFixed(2)}%</span><strong>${amt(calc.vat)}</strong></div><div class="grand"><span>Definitives Total</span><strong>${amt(calc.total)}</strong></div></div>
    ${calc.sourceDifference!==0?`<div class="notice warning">Originalwerte weichen um ${amt(calc.sourceDifference)} voneinander ab. PDF-Ausgabe gesperrt.</div>`:''}
    ${calc.roundingDifference!==0?`<div class="notice warning">Rundungsdifferenz: Die rechnerische Bruttopreisminderung weicht um ${amt(calc.roundingDifference)} vom gewünschten Eintausch ab. Bitte prüfen und bei Abweichung von höchstens CHF 0.01 ausdrücklich bestätigen.</div>`:''}`;
}
function generateActions(){return `<button class="btn secondary full-width" id="make-preview">PDF-Vorschau erstellen</button>
  ${issued?`<label class="toggle"><input id="checked-preview" type="checkbox"><span>Ich habe Datum, Positionen, Seiten und Total visuell geprüft.</span></label><div class="button-row"><button class="btn ghost" id="download-preview">PDF herunterladen</button><button class="btn primary" id="save-invoice" ${connected()?'':'disabled title="Supabase-Verbindung erforderlich"'}>Rechnung definitiv speichern</button></div>`:''}`;}
function resetPreview(){issued=null;if(pdfUrl)URL.revokeObjectURL(pdfUrl);pdfUrl=null;$('#pdf-viewer')?.replaceChildren();if($('#generate-actions'))$('#generate-actions').innerHTML=generateActions();}
async function loadFile(file){
  if(!file)return;
  if(!file.name.toLowerCase().endsWith('.pdf'))throw new Error('Bitte eine PDF-Datei wählen.');
  if(file.size>18*1024*1024)throw new Error('Datei über 18 MB; bitte einen kompakteren ERP-Export verwenden.');
  analysis=null;resetPreview();sourceBytes=new Uint8Array(await file.arrayBuffer());analysis=await analyzePdf(sourceBytes);
  if(!analysis.report)alertBox('Rapportnummer nicht erkannt. Bitte Vorlage prüfen.','warning');
  else if(!analysis.summary)alertBox('Originalsummen nicht eindeutig erkannt. Keine PDF-Freigabe möglich.','warning');
  else if(analysis.rates.length>1)alertBox('Mehrere MwSt-Sätze erkannt. Bei Eintausch ist eine steuerliche Prüfung notwendig.','warning');
  else clearAlert();
  renderCreate();
}
function getCreateValues(){
  const calc=getCalculation();
  const number=$('#invoice-number')?.value.trim(), customer=$('#customer-name')?.value.trim(), date=$('#invoice-date')?.value;
  const customerNo=$('#customer-number')?.value.trim()||'',machine=$('#machine')?.value.trim()||'';
  const premium=parseMoney($('#premium-gross')?.value||'0.00');
  if(!number||number!==analysis.report)throw new Error('Rechnungsnummer muss der Rapportnummer entsprechen.');
  if(!customer)throw new Error('Bitte Kundenname prüfen und ergänzen.');
  if(!/^\d{4}-\d\d-\d\d$/.test(date)||Number.isNaN(new Date(date+'T12:00:00').getTime()))throw new Error('Rechnungsdatum fehlt oder ist ungültig.');
  if(premium<0)throw new Error('Prämienbetrag darf nicht negativ sein.');
  if(Math.abs(calc.roundingDifference)>1||calc.sourceDifference!==0)throw new Error('Rechenprüfung nicht bestanden; PDF-Ausgabe gesperrt.');
  return {number,customer,date,customerNo,machine,premium,calc};
}
async function makePreview(){
  const vals=getCreateValues();
  const button=$('#make-preview');setBusy(button,true,'PDF wird geprüft …');
  try{
    const result=await renderInvoicePdf(analysis,{number:vals.number,date:vals.date,tradeGross:vals.calc.tradeGross});
    issued={pdfBytes:result.bytes,vals,filename:invoiceFilename(vals.number,vals.customer)};
    if(pdfUrl)URL.revokeObjectURL(pdfUrl);
    pdfUrl=URL.createObjectURL(new Blob([result.bytes],{type:'application/pdf'}));
    $('#pdf-viewer').innerHTML=`<iframe title="Rechnungsvorschau" src="${pdfUrl}"></iframe>`;
    $('#generate-actions').innerHTML=generateActions();
    alertBox('PDF-Vorschau erstellt. Vor der definitiven Speicherung unbedingt visuell kontrollieren.','success');
  } catch(error){alertBox(error.message,'error');} finally {setBusy(button,false);}
}
function downloadBlob(blob,filename){const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download=filename;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),10000);}
function downloadPreview(){if(!issued)return;downloadBlob(new Blob([issued.pdfBytes],{type:'application/pdf'}),issued.filename);}
async function saveInvoice(){
  if(!connected())throw new Error('Bitte zuerst die geschützte Datenbank einrichten.');
  if(!issued)throw new Error('PDF-Vorschau fehlt.');
  if(!$('#checked-preview')?.checked)throw new Error('Bitte die visuelle Prüfung bestätigen.');
  if(issued.vals.calc.roundingDifference!==0&&!$('#checked-rounding')?.checked)throw new Error('Bitte die Rundungsdifferenz ausdrücklich bestätigen.');
  // Eingaben dürfen nach Vorschau nicht unbemerkt geändert werden.
  const vals=getCreateValues();
  if(JSON.stringify(vals)!==JSON.stringify(issued.vals))throw new Error('Angaben wurden nach der PDF-Vorschau geändert. Bitte neue Vorschau erstellen.');
  const duplicate=await supabase.from('lgt_invoices').select('id').eq('number',vals.number).maybeSingle();
  if(duplicate.error)throw duplicate.error;
  if(duplicate.data)throw new Error(`Rechnung Nr. ${vals.number} ist bereits im Archiv.`);
  const id=crypto.randomUUID();
  const sourcePath=`invoices/${id}/original.pdf`,issuedPath=`invoices/${id}/${issued.filename}`;
  const payload={id,number:vals.number,invoice_date:vals.date,customer_name:vals.customer,customer_number:vals.customerNo,
    machine:vals.machine,original_net_cents:analysis.summary.originalNet,original_vat_cents:analysis.summary.originalVat,
    original_total_cents:analysis.summary.originalTotal,additional_trade_gross_cents:vals.calc.tradeGross,
    trade_discount_net_cents:vals.calc.discountNet,net_cents:vals.calc.net,vat_cents:vals.calc.vat,
    total_cents:vals.calc.total,vat_bps:analysis.summary.vatBps,source_has_trade:analysis.standaloneTrade,
    original_pdf_path:sourcePath,issued_pdf_path:issuedPath,files_ready:false,created_by:user.id};
  const {error:insertErr}=await supabase.from('lgt_invoices').insert(payload);
  if(insertErr)throw insertErr;
  const bucket=supabase.storage.from('lgt-rechnungen');
  const a=await bucket.upload(sourcePath,new Blob([sourceBytes],{type:'application/pdf'}),{contentType:'application/pdf',upsert:false});
  const b=a.error?null:await bucket.upload(issuedPath,new Blob([issued.pdfBytes],{type:'application/pdf'}),{contentType:'application/pdf',upsert:false});
  if(a.error||b?.error)throw new Error(`Rechnung #${vals.number} angelegt, aber PDF-Upload unvollständig. Bitte Administrationsprüfung: ${a.error?.message||b?.error?.message}`);
  const ready=await supabase.from('lgt_invoices').update({files_ready:true}).eq('id',id);
  if(ready.error)throw ready.error;
  if(vals.premium>0){
    const c=await supabase.from('lgt_claims').insert({invoice_id:id,claimed_amount_cents:vals.premium,
      received_amount_cents:0,status:'open',supplier:'Husqvarna',created_by:user.id});
    if(c.error)alertBox(`Rechnung gespeichert, Prämienerfassung fehlgeschlagen: ${c.error.message}`,'warning');
  }
  downloadPreview();
  analysis=null;sourceBytes=null;resetPreview();
  await reloadRecords();nav('invoices');
  alertBox(`Rechnung Nr. ${vals.number} erstellt, archiviert und als PDF heruntergeladen.`,'success');
}
async function archivedDownload(id){
  const inv=invoices.find(i=>i.id===id);if(!inv?.files_ready)throw new Error('PDF ist noch nicht vollständig gespeichert.');
  const r=await supabase.storage.from('lgt-rechnungen').download(inv.issued_pdf_path);
  if(r.error)throw r.error;downloadBlob(r.data,invoiceFilename(inv.number,inv.customer_name));
}
async function ask({title,body,confirm='Speichern'}){
  const dialog=$('#dialog');$('#dialog-title').textContent=title;$('#dialog-body').innerHTML=body;$('#dialog-confirm').textContent=confirm;
  dialog.showModal();return new Promise(resolve=>{const form=$('#dialog-form');
    const handler=(e)=>{const ok=e.submitter?.value==='confirm';if(ok&&!form.checkValidity()){e.preventDefault();form.reportValidity();return;}
      form.removeEventListener('submit',handler);resolve(ok?Object.fromEntries(new FormData(form).entries()):null);};form.addEventListener('submit',handler);});
}
async function recordClaim(id,mode){
  const claim=claims.find(c=>c.id===id);if(!claim)throw new Error('Prämie nicht gefunden.');
  if(mode==='requested'){
    const val=await ask({title:'Einforderung bei Husqvarna',confirm:'Einforderung dokumentieren',body:`<p>Ab jetzt ist dieser Betrag als bei Husqvarna eingefordert gekennzeichnet.</p><label>Datum der Einforderung<input type="date" name="date" value="${swissDate()}" required></label><label>Referenz / Bemerkung<input name="reference" placeholder="Husqvarna-Antragsnummer (optional)"></label>`});
    if(!val)return;
    const before={...claim};
    const r=await supabase.from('lgt_claims').update({status:'claimed',claimed_on:val.date,reference:val.reference||null}).eq('id',id).eq('status','open');
    if(r.error)throw r.error;
    await appendEvent(id,'claimed',{previous_status:before.status,date:val.date,reference:val.reference||''});
  }else{
    const val=await ask({title:'Zahlung von Husqvarna erfassen',confirm:'Zahlung verbuchen',body:`<p>Bitte kumulativ den bisher effektiv erhaltenen Betrag erfassen. Prämie: <strong>${amt(claim.claimed_amount_cents)}</strong>.</p><label>Insgesamt erhalten (CHF)<input name="received" inputmode="decimal" value="${((claim.received_amount_cents||0)/100).toFixed(2)}" required></label><label>Datum Zahlungseingang<input type="date" name="date" value="${swissDate()}" required></label><label>Bemerkung<input name="note" placeholder="Zahlung / Differenz (optional)"></label>`});
    if(!val)return;
    const received=parseMoney(val.received);
    if(received<0||received>claim.claimed_amount_cents)throw new Error('Zahlung muss zwischen CHF 0.00 und eingefordertem Betrag liegen.');
    const next=received===claim.claimed_amount_cents?'paid':'partial';
    const r=await supabase.from('lgt_claims').update({received_amount_cents:received,received_on:val.date,status:next,note:val.note||null}).eq('id',id);
    if(r.error)throw r.error;
    await appendEvent(id,next,{previous_status:claim.status,received_amount_cents:received,date:val.date,note:val.note||''});
  }
  await reloadRecords();render();alertBox('Prämienstatus gespeichert.','success');
}
async function appendEvent(claimId,action,details){
  const r=await supabase.from('lgt_claim_events').insert({claim_id:claimId,action,details,actor_id:user.id});
  if(r.error)alertBox(`Status gespeichert, aber Verlaufsprotokoll fehlgeschlagen: ${r.error.message}`,'warning');
}
async function claimHistory(id){
  const r=await supabase.from('lgt_claim_events').select('*').eq('claim_id',id).order('created_at',{ascending:false});
  if(r.error)throw r.error;
  await ask({title:'Verlauf der Husqvarna-Prämie',confirm:'Schliessen',body:`<div class="timeline">${(r.data||[]).length?(r.data||[]).map(e=>`<div><strong>${esc(e.action)}</strong><small>${new Date(e.created_at).toLocaleString('de-CH')}</small><pre>${esc(JSON.stringify(e.details,null,2))}</pre></div>`).join(''):'Noch kein Eintrag'}</div>`});
}

// Event-Delegation auch bei neu gerenderten Ansichten.
document.addEventListener('click',async e=>{
  const b=e.target.closest('button');if(!b)return;
  try{
    if(b.dataset.view){clearAlert();nav(b.dataset.view);return;}
    if(b.id==='logout-btn'||b.id==='auth-signout'){await supabase.auth.signOut();user=null;authorized=false;invoices=[];claims=[];render();return;}
    if(b.id==='make-preview'){await makePreview();return;}
    if(b.id==='download-preview'){downloadPreview();return;}
    if(b.id==='save-invoice'){setBusy(b,true,'Wird gespeichert …');try{await saveInvoice();}finally{setBusy(b,false);}return;}
    if(b.dataset.download){await archivedDownload(b.dataset.download);return;}
    if(b.dataset.claimRequest){await recordClaim(b.dataset.claimRequest,'requested');return;}
    if(b.dataset.claimPaid){await recordClaim(b.dataset.claimPaid,'paid');return;}
    if(b.dataset.claimHistory){await claimHistory(b.dataset.claimHistory);return;}
  }catch(error){console.error(error);alertBox(error.message||String(error),'error');}
});
document.addEventListener('submit',async e=>{
  if(e.target.id!=='login-form')return;e.preventDefault();
  const b=e.target.querySelector('button[type=submit]');setBusy(b,true,'Anmelden …');
  const data=new FormData(e.target);
  const r=await supabase.auth.signInWithPassword({email:data.get('email'),password:data.get('password')});
  if(r.error)alertBox(r.error.message,'error');else{user=r.data.user;await loadStaffAndRecords();clearAlert();render();}
  setBusy(b,false);
});
document.addEventListener('change',async e=>{
  if(e.target.id==='pdf-file'){try{await loadFile(e.target.files[0]);}catch(error){alertBox(error.message,'error');}return;}
  if(e.target.id==='contained'){const trade=$('#trade-gross');trade.disabled=e.target.checked;if(e.target.checked)trade.value='0.00';resetPreview();$('#calc-panel').innerHTML=renderCalculation();return;}
  if(['invoice-date','trade-gross','customer-name','customer-number','machine','premium-gross'].includes(e.target.id)){
    resetPreview();if(analysis)$('#calc-panel').innerHTML=renderCalculation();return;
  }
  if(e.target.id==='claim-filter'){$('#claim-results').innerHTML=claimTable(e.target.value==='all'?claims:claims.filter(c=>c.status===e.target.value));}
});
document.addEventListener('input',e=>{
  if(e.target.id==='invoice-search'){const q=e.target.value.toLocaleLowerCase('de-CH');$('#invoice-results').innerHTML=invoiceTable(invoices.filter(i=>[i.number,i.customer_name,i.machine,i.customer_number].some(v=>String(v||'').toLocaleLowerCase('de-CH').includes(q))));}
});
initialize();