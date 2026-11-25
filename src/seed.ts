import type { Config, Row, Seed } from './config.js';
import { matchesType } from './config.js';

function projectFields(data: unknown, fields: string[], path: string): Row {
  if (!data || Array.isArray(data) || typeof data !== 'object')
    throw Error('Expected a flat JSON object at ' + path);
  const row: Row = {};
  for (const field of fields) {
    if (!Object.hasOwn(data, field)) continue;
    const value: unknown = (data as Record<string, unknown>)[field];
    if (typeof value !== 'string' && typeof value !== 'number' && typeof value !== 'boolean') {
      throw Error('Only scalar seed fields are supported: ' + path + '.' + field);
    }
    row[field] = value;
  }
  return row;
}

export async function captureSeed(config: Config, origin: string): Promise<Seed> {
  const seed: Seed = { resources: {}, reads: {} };
  for (const spec of [...config.resources, ...config.reads]) {
    const response = await fetch(new URL(spec.path, origin), {
      redirect: 'error',
      signal: AbortSignal.timeout(10000),
    });
    if (!response.ok) throw Error('Seed GET ' + spec.path + ' returned HTTP ' + response.status);
    const raw: unknown = await response.json();
    if ('operations' in spec) {
      if (!Array.isArray(raw))
        throw Error('Seed GET ' + spec.path + ' must return an unpaginated JSON array.');
      const ids = new Set();
      seed.resources[spec.path] = raw.map((item) => {
        const row = projectFields(item, Object.keys(spec.fields), spec.path);
        const id = row[spec.key];
        if (
          spec.id === 'integer' ? !Number.isSafeInteger(id) : typeof id !== 'string' || !id.length
        )
          throw Error('Invalid seed ID at ' + spec.path);
        if (ids.has(id)) throw Error('Duplicate seed ID at ' + spec.path);
        ids.add(id);
        for (const name of spec.required)
          if (!Object.hasOwn(row, name)) throw Error('Missing required seed field: ' + name);
        for (const [name, value] of Object.entries(row)) {
          if (!matchesType(value, spec.fields[name]!))
            throw Error('Invalid seed value at ' + spec.path + '.' + name);
        }
        return row;
      });
    } else {
      const row = projectFields(raw, spec.fields, spec.path);
      for (const name of spec.fields)
        if (!Object.hasOwn(row, name)) throw Error('Missing read field: ' + name);
      seed.reads[spec.path] = row;
    }
  }
  return seed;
}
