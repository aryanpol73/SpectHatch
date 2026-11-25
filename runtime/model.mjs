// The storage-independent part of the sandbox. A transaction commits "next" only on success.
export function locate(contract, path) {
  if (contract.reads.some((read) => read.path === path)) return { path, kind: 'read' };
  for (const resource of contract.resources) {
    if (path === resource.path) return { path, resource, id: null, kind: 'resource' };
    if (!path.startsWith(resource.path + '/')) continue;
    const tail = path.slice(resource.path.length + 1);
    if (!tail || tail.includes('/')) continue;
    try {
      return { path: resource.path, resource, id: decodeURIComponent(tail), kind: 'resource' };
    } catch {
      return null;
    }
  }
  return null;
}

const failure = (status, message) => ({ status, body: { error: message } });
const unsupported = (message) => ({ ...failure(501, message), unsupported: true });

export function operate(match, method, params, body, data, makeUUID = () => crypto.randomUUID()) {
  if (!match) return unsupported('This route is outside the demo contract.');
  if (match.kind === 'read') {
    if (method !== 'GET' || params.size)
      return unsupported('This captured read supports GET without a query.');
    return { status: 200, body: data };
  }
  const { resource: r, id } = match;
  const op =
    id === null
      ? { GET: 'list', POST: 'create' }[method]
      : { GET: 'get', PATCH: 'update', DELETE: 'delete' }[method];
  if (!op || !r.operations.includes(op))
    return unsupported('Operation is outside the demo contract.');
  for (const [key] of params) {
    if (op !== 'list' || !r.filterBy.includes(key) || params.getAll(key).length !== 1)
      return unsupported('Unmodeled query parameter.');
  }
  const rows = data.rows;
  if (op === 'list') {
    const filters = [...params.entries()];
    return {
      status: 200,
      body: rows.filter((row) =>
        filters.every(([k, v]) => Object.hasOwn(row, k) && String(row[k]) === v),
      ),
    };
  }
  const index = rows.findIndex((row) => String(row[r.key]) === id);
  if (op !== 'create' && index < 0) return failure(404, 'Record does not exist.');
  if (op === 'get') return { status: 200, body: rows[index] };
  if (op === 'delete')
    return { status: 204, body: null, next: { ...data, rows: rows.filter((_, n) => n !== index) } };
  if (!body || typeof body !== 'object' || Array.isArray(body))
    return failure(400, 'Expected a JSON object.');
  for (const [key, value] of Object.entries(body)) {
    if (!r.writable.includes(key)) return failure(422, 'Field is not writable: ' + key);
    const type = r.fields[key];
    if (Array.isArray(type) ? !type.includes(value) : typeof value !== type)
      return failure(422, 'Invalid value for ' + key);
  }
  const row = { ...(op === 'create' ? r.defaults : rows[index]), ...body };
  let counter = data.counter;
  if (op === 'create') {
    if (r.id === 'integer' && !Number.isSafeInteger(counter + 1))
      return failure(409, 'Integer IDs exhausted.');
    row[r.key] = r.id === 'integer' ? ++counter : makeUUID();
  }
  for (const key of r.required) {
    if (!Object.hasOwn(row, key) || (typeof row[key] === 'string' && !row[key].trim()))
      return failure(422, 'Required field: ' + key);
  }
  const nextRows =
    op === 'create' ? [...rows, row] : rows.map((previous, n) => (n === index ? row : previous));
  return { status: op === 'create' ? 201 : 200, body: row, next: { rows: nextRows, counter } };
}

export function initialState(resource, rows) {
  return {
    rows,
    counter:
      resource.id === 'integer' ? rows.reduce((n, row) => Math.max(n, row[resource.key]), 0) : 0,
  };
}
