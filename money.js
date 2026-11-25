// Beträge ausschliesslich als ganzzahlige Rappen verarbeiten: keine Float-Rechenfehler.
export function parseMoney(value) {
  if (typeof value === 'number' && Number.isSafeInteger(value)) return value;
  const raw = String(value ?? '').trim().replace(/[’'\u00a0\s]/g, '').replace(/^(CHF|Fr\.?)/i, '');
  if (!raw) throw new Error('Betrag fehlt.');
  const match = raw.match(/^(-?)(\d+)(?:[.,](\d{1,2}))?$/);
  if (!match) throw new Error(`Ungültiger Betrag: ${value}`);
  const n = Number(match[2]) * 100 + Number((match[3] ?? '').padEnd(2, '0'));
  if (!Number.isSafeInteger(n)) throw new Error('Betrag zu gross.');
  return match[1] ? -n : n;
}
export function formatMoney(cents, prefix = 'CHF ') {
  if (!Number.isSafeInteger(cents)) return '—';
  const neg = cents < 0 ? '−' : '';
  const abs = Math.abs(cents);
  const integer = Math.floor(abs / 100).toString().replace(/\B(?=(\d{3})+(?!\d))/g, '’');
  return `${prefix}${neg}${integer}.${String(abs % 100).padStart(2,'0')}`;
}
export function parseVatBps(rate) { // z.B. "8.10" -> 810 Basispunkte
  const val = String(rate ?? '').trim().replace('%','').replace(',','.');
  if (!/^\d{1,2}(\.\d{1,2})?$/.test(val)) throw new Error('MwSt-Satz ungültig.');
  const [whole, decimal = ''] = val.split('.');
  const n = Number(whole) * 100 + Number(decimal.padEnd(2,'0'));
  if (n <= 0 || n > 9999) throw new Error('MwSt-Satz ausserhalb des erlaubten Bereichs.');
  return n;
}
export function formatRate(bps) { return `${(bps / 100).toFixed(2)}%`; }
export function roundDivide(numerator, denominator) {
  if (!Number.isSafeInteger(numerator) || !Number.isSafeInteger(denominator) || denominator <= 0) throw new Error('Ungültige Berechnung.');
  return Math.sign(numerator) * Math.floor((Math.abs(numerator) + Math.floor(denominator / 2)) / denominator);
}
export function recalculate({originalNet, originalVat, originalTotal, tradeGross, vatBps}) {
  for (const n of [originalNet,originalVat,originalTotal,tradeGross,vatBps]) if (!Number.isSafeInteger(n)) throw new Error('Ungültige Rechnungsdaten.');
  if (tradeGross < 0) throw new Error('Der Eintauschbetrag muss positiv sein.');
  if (tradeGross === 0) return {discountNet:0,net:originalNet,vat:originalVat,total:originalTotal, effectiveGross:0,roundingDifference:0,sourceDifference:originalTotal-originalNet-originalVat};
  const baseDiscount = roundDivide(tradeGross * 10000, 10000 + vatBps);
  const candidates = [...new Set([baseDiscount, baseDiscount - 1, baseDiscount + 1, baseDiscount - 2, baseDiscount + 2])].filter(x=>x>=0);
  const possibilities = candidates.map(discountNet => {
    const net = originalNet - discountNet;
    const vat = roundDivide(net * vatBps, 10000);
    const total = net + vat;
    return {discountNet, net, vat, total, effectiveGross: originalTotal - total,
      remainder: originalTotal - originalNet - originalVat};
  });
  const chosen = possibilities.find(p => p.effectiveGross === tradeGross) ?? possibilities[0];
  return {...chosen, roundingDifference: chosen.effectiveGross - tradeGross,
    sourceDifference: originalTotal - originalNet - originalVat};
}
export function swissDate(date = new Date()) {
  const dateParts = new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/Zurich',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(date);
  const obj = Object.fromEntries(dateParts.map(p=>[p.type,p.value]));
  return `${obj.year}-${obj.month}-${obj.day}`;
}
export function chDate(iso) { const m=String(iso??'').match(/^(\d{4})-(\d{2})-(\d{2})$/); return m ? `${m[3]}.${m[2]}.${m[1]}` : ''; }
// ERP kann das Bruttototal auf 5 Rappen runden. Grössere Abweichungen sind keine übliche Rundung.
export const ERP_ROUNDING_TOLERANCE = 5;
export function sourceRoundingAllowed(calc) { return Math.abs(calc.sourceDifference) <= ERP_ROUNDING_TOLERANCE; }
