import assert from 'node:assert/strict';
import test from 'node:test';
import { initialState, locate, operate } from '../runtime/model.mjs';
import { validateConfig } from '../dist/config.js';
import fixture from '../examples/relay/spechatch.config.mjs';
const contract = validateConfig(fixture);
const resource = contract.resources[0];
const blank = () => initialState(resource, []);
const call = (path, method, data, body, query = '') =>
  operate(locate(contract, path), method, new URLSearchParams(query), body, data);
const base = '/api/issues';

test('create, get, edit and delete arbitrary visitor data', () => {
  const created = call(base, 'POST', blank(), { title: 'Visitor input' });
  assert.equal(created.status, 201);
  assert.equal(created.body.status, 'Backlog');
  const edit = call(base + '/1', 'PATCH', created.next, { status: 'Done' });
  assert.equal(edit.body.title, 'Visitor input');
  assert.equal(call(base + '/1', 'GET', edit.next).body.status, 'Done');
  const deleted = call(base + '/1', 'DELETE', edit.next);
  assert.equal(deleted.status, 204);
  assert.equal(call(base + '/1', 'GET', deleted.next).status, 404);
  assert.equal(call(base, 'POST', deleted.next, { title: 'Different issue' }).body.id, 2);
});

test('matches exact collection filters and rejects unknown query shapes', () => {
  const data = call(base, 'POST', blank(), { title: 'Fix', priority: 'High' }).next;
  assert.equal(call(base, 'GET', data, null, 'priority=High').body.length, 1);
  assert.equal(call(base, 'GET', data, null, 'status=Done').body.length, 0);
  for (const q of ['limit=5', 'status=Done&status=Backlog'])
    assert.equal(call(base, 'GET', data, null, q).unsupported, true);
});

test('invalid writes cannot mutate a record or consume an ID', () => {
  const state = blank();
  for (const body of [
    null,
    [],
    {},
    { title: '  ' },
    { title: 'A', status: 'Invented' },
    { title: 'A', privateNote: 'x' },
    { title: 'A', id: 8 },
  ]) {
    const rejected = call(base, 'POST', state, body);
    assert.ok([400, 422].includes(rejected.status));
    assert.equal(rejected.next, undefined);
  }
  assert.deepEqual(state, { rows: [], counter: 0 });
});
test('unsupported endpoints, methods and nested paths are explicit', () => {
  for (const [path, method] of [
    [base, 'PUT'],
    [base + '/1/note', 'GET'],
    ['/api/missing', 'GET'],
    ['/api/workspace', 'POST'],
  ]) {
    assert.equal(call(path, method, blank(), {}).status, 501);
  }
});
test('supports non-default IDs and read-only objects', () => {
  const r = {
    ...resource,
    id: 'uuid',
    key: 'uuid',
    fields: { ...resource.fields, uuid: 'string' },
  };
  const newRow = operate(
    { kind: 'resource', path: base, id: null, resource: r },
    'POST',
    new URLSearchParams(),
    { title: 'Portable' },
    initialState(r, []),
    () => 'sample-uuid',
  );
  assert.equal(newRow.body.uuid, 'sample-uuid');
  assert.deepEqual(call('/api/workspace', 'GET', { team: 'Relay' }).body, { team: 'Relay' });
});
test('configuration rejects duplicate and ambiguous routes, writable keys and bad defaults', () => {
  const copy = () => structuredClone(fixture);
  for (const change of [
    (c) => c.reads.push({ path: base, fields: ['id'] }),
    (c) => c.reads.push({ path: base + '/meta', fields: ['id'] }),
    (c) => c.resources[0].writable.push('id'),
    (c) => {
      c.resources[0].defaults.status = 'Unexpected';
    },
    (c) => {
      c.resources[0].path = '/elsewhere';
    },
    (c) => {
      c.resources[0].fileds = ['oops'];
    },
  ]) {
    const c = copy();
    change(c);
    assert.throws(() => validateConfig(c));
  }
});
