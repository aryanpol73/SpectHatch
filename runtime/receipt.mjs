const byId = (id) => document.getElementById(id);
function element(tag, text, className) {
  const n = document.createElement(tag);
  n.textContent = text;
  if (className) n.className = className;
  return n;
}
function row(parent, values) {
  const tr = document.createElement('tr');
  for (const value of values) tr.append(element('td', value));
  parent.append(tr);
  return tr;
}
try {
  const res = await fetch('./receipt.json');
  if (!res.ok) throw Error('No verified build receipt is available.');
  const r = await res.json();
  byId('project').textContent = r.project;
  byId('summary').textContent =
    'The same Playwright workflows passed against the live app and this export after its backend stopped.';
  for (const [label, value] of [
    ['Workflows', r.tests.length],
    ['API requests in replay', r.requestCount],
    ['Unexpected requests', r.misses],
  ]) {
    const block = document.createElement('div');
    block.append(element('strong', String(value)), element('span', label));
    byId('facts').append(block);
  }
  for (const t of r.tests) {
    const tr = row(byId('cases'), [
      t.title,
      '✓  Pass · ' + (t.liveMs / 1000).toFixed(1) + 's',
      '✓  Pass · ' + (t.replayMs / 1000).toFixed(1) + 's',
    ]);
    tr.cells[0].append(element('small', t.file + ':' + t.line, 'case-file'));
  }
  for (const route of r.routes)
    row(byId('routes'), [route.method, route.path, String(route.count)]);
  byId('fingerprint').textContent =
    'Build ' + r.buildId.slice(0, 12) + ' · ' + new Date(r.verifiedAt).toISOString().slice(0, 10);
  byId('results').hidden = false;
} catch (error) {
  byId('summary').textContent = error.message;
}
