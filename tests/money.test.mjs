import test from 'node:test';
import assert from 'node:assert/strict';
import {parseMoney,formatMoney,parseVatBps,roundDivide,recalculate,chDate,sourceRoundingAllowed,husqvarnaRefund} from '../money.js';

test('Schweizer Beträge werden rappen-genau geparst',()=>{
  assert.equal(parseMoney('1’193.34'),119334);
  assert.equal(parseMoney('Fr. -2’220.17'),-222017);
  assert.equal(parseMoney('350'),35000);
  assert.equal(parseMoney('350,5'),35050);
  assert.equal(formatMoney(-32377),'CHF −323.77');
});
test('Schweizer MwSt-Satz und kaufmännische Rundung',()=>{
  assert.equal(parseVatBps('8.10%'),810);
  assert.equal(roundDivide(105,10),11);
  assert.equal(roundDivide(-105,10),-11);
});
test('Bei Nur Rechnung bleiben Originalbeträge unverändert',()=>{
  const r=recalculate({originalNet:202211,originalVat:16379,originalTotal:218590,tradeGross:0,vatBps:810});
  assert.equal(r.net,202211);assert.equal(r.vat,16379);assert.equal(r.total,218590);
  assert.equal(r.sourceDifference,0);assert.equal(r.roundingDifference,0);
});
test('CHF 350 Eintausch meldet 1 Rappen Rundungsdifferenz bei Beispielrechnung',()=>{
  const r=recalculate({originalNet:202211,originalVat:16379,originalTotal:218590,tradeGross:35000,vatBps:810});
  assert.equal(r.discountNet,32377);assert.equal(r.net,169834);assert.equal(r.vat,13757);
  assert.equal(r.total,183591);assert.equal(r.roundingDifference,-1);
});
test('Negatives Original und Datumsformat',()=>{
  const r=recalculate({originalNet:-31565,originalVat:-2557,originalTotal:-34122,tradeGross:0,vatBps:810});
  assert.equal(r.total,-34122);assert.equal(chDate('2026-11-25'),'25.11.2026');
});
test('ERP-Rundung von fünf Rappen bleibt bei Nur Rechnung unverändert und ist zulässig',()=>{
  const r=recalculate({originalNet:10000,originalVat:810,originalTotal:10815,tradeGross:0,vatBps:810});
  assert.equal(r.net,10000);assert.equal(r.vat,810);assert.equal(r.total,10815);assert.equal(r.sourceDifference,5);assert.equal(sourceRoundingAllowed(r),true);
  assert.equal(sourceRoundingAllowed({...r,sourceDifference:-5}),true);
  assert.equal(sourceRoundingAllowed({...r,sourceDifference:6}),false);
});
test('Eintausch mit ERP-Rundung berechnet neue konsistente Summen',()=>{
  const r=recalculate({originalNet:10000,originalVat:810,originalTotal:10815,tradeGross:1000,vatBps:810});
  assert.equal(sourceRoundingAllowed(r),true);assert.equal(r.net+r.vat,r.total);assert.equal(r.sourceDifference,5);
});

// 50 % der Kundenprämie, kaufmännisch auf Rappen gerundet.
test('Husqvarna refunds half of the gross customer premium',()=>{
 assert.equal(husqvarnaRefund(15000),7500);
 assert.equal(husqvarnaRefund(30000),15000);
 assert.equal(husqvarnaRefund(15001),7501);
 assert.equal(husqvarnaRefund(0),0);
});
