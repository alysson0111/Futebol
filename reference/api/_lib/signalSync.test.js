import test from "node:test";
import assert from "node:assert/strict";
import { readSignalSync, readPendingSignals } from "../signals.js";
import { selectPendingSignalIds } from "../../src/analysis/reportSignals.js";

test("report polls read changes and at most twenty pending records, not the entire bank", async () => {
  const calls = [];
  const time = { toDate: () => new Date("2026-10-10T12:00:00Z") };
  const doc = (id) => ({ id, exists: true, data: () => ({ result: "pendente" }) });
  const query = {
    where(...args) { calls.push(["where", ...args]); return this; },
    orderBy(...args) { calls.push(["orderBy", ...args]); return this; },
    limit() { return this; },
    async get() { return { docs: [doc("changed")], size: 1, readTime: time }; },
    doc(id) { return { id }; }
  };
  const db = {
    collection: () => query,
    async getAll(...refs) {
      assert.equal(refs.length, 20);
      return refs.map((ref) => doc(ref.id));
    }
  };
  const params = new URLSearchParams({ since: "2026-10-10T11:59:00Z", pendingIds: Array.from({ length: 30 }, (_, i) => `pending${i}`).join(",") });
  const result = await readSignalSync(db, params);
  assert.equal(calls[0][0], "where");
  assert.equal(calls[0][1], "updatedAt");
  assert.equal(calls.some((call) => call.includes("createdAt")), false);
  assert.equal(result.signals.length, 21);
  assert.equal(result.syncToken, "2026-10-10T12:00:00.000Z");
});

test("pending rotation revisits every signal and skips confirmed results", () => {
  const signals = Array.from({ length: 45 }, (_, i) => ({ id: String(i), result: "pendente" }));
  signals.push({ id: "final", result: "green", finalConfirmed: true });
  let offset = 0;
  const visited = new Set();
  for (let i = 0; i < 3; i++) {
    const selection = selectPendingSignalIds(signals, offset);
    selection.ids.forEach((id) => visited.add(id));
    offset = selection.nextOffset;
  }
  assert.equal(visited.size, 45);
  assert.equal(visited.has("final"), false);
});

test('server recovery reads pending records independently of browser IDs and rotates full pages', async () => {
  const calls = [];
  const docs = Array.from({length:1000},(_,i)=>({id:`id${i}`,data:()=>({result:'pendente'})}));
  const query = { where(...args){calls.push(args);return this;}, orderBy(...args){calls.push(args);return this;},limit(n){assert.equal(n,1000);return this;},startAfter(value){calls.push(['cursor',value]);return this;},async get(){return {docs,size:docs.length};} };
  const result = await readPendingSignals({collection:()=>query}, 'previous');
  assert.equal(result.signals.length,1000);
  assert.equal(result.nextCursor,'id999');
  assert.deepEqual(calls[0],['result','==','pendente']);
  assert.ok(calls.some(call=>call[0]==='cursor'));
});

test('server recovery wraps around when the last pending page has disappeared', async () => {
  let reads=0;
  const query = {where(){return this;},orderBy(){return this;},limit(){return this;},startAfter(){return this;},async get(){reads++;return reads===1?{docs:[],size:0}:{docs:[{id:'old',data:()=>({result:'pendente'})}],size:1};}};
  const result=await readPendingSignals({collection:()=>query},'deleted-last');
  assert.equal(result.signals[0].id,'old');
  assert.equal(result.nextCursor,'');
});
