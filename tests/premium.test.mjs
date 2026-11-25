import test from 'node:test';
import assert from 'node:assert/strict';
import {detectPremium} from '../invoice.js';
test('wrapped premium with quantity and price columns',()=>assert.deepEqual(detectPremium(['Serie R4/305/308V/312V Eintauschprämie (150.- 1 Stk. -138.76 -138.76','inkl. MwSt.)']),{gross:15000,found:1,unresolved:0}));
test('same-line inclusive premium',()=>assert.equal(detectPremium(['Eintauschprämie (CHF 150.00 inkl. MwSt.)']).gross,15000));
test('two separate premiums',()=>assert.equal(detectPremium(['Eintauschprämie (150.- inkl. MwSt.)','Eintauschprämie (200.- inkl. MwSt.)']).gross,35000));
test('standalone exchange is not supplier premium',()=>assert.equal(detectPremium(['Eintausch 1 Stk. -323.77']).found,0));
test('unclear net price is not mistaken for gross',()=>assert.equal(detectPremium(['Eintauschprämie 1 Stk. -138.76 -138.76']).unresolved,1));
test('amount on next line',()=>assert.equal(detectPremium(['Eintauschprämie (','150.- inkl. MwSt.)']).gross,15000));
