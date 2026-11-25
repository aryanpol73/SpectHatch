import React, { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import './style.css';

const stages = ['Backlog', 'In progress', 'Done'];
const areas = ['Design', 'Platform', 'Product'];
const blank = { title: '', detail: '', area: 'Product', priority: 'Normal', status: 'Backlog' };
const issueKey = (id) => 'RLY-' + String(id).padStart(3, '0');
async function api(path, method = 'GET', body) {
  const response = await fetch('/api/' + path, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  if (response.status === 204) return;
  const data = await response.json();
  if (!response.ok) throw Error(data.error || 'Could not save changes.');
  return data;
}
function Brand() {
  return (
    <header className="topbar">
      <div className="brandmark" aria-hidden="true">
        <i />
        <i />
        <i />
      </div>
      <b>Relay</b>
      <span className="sep">/</span>
      <span className="workname">Workspace</span>
      <span className="team-label">
        <i /> Product engineering
      </span>
    </header>
  );
}
function Progress({ issues, workspace }) {
  const done = issues.filter((t) => t.status === 'Done').length;
  const percent = issues.length ? Math.round((100 * done) / issues.length) : 0;
  return (
    <aside className="cycle" aria-label="Cycle progress">
      <div className="cycle-head">
        <span>Cycle {workspace.cycle}</span>
        <span className="cycle-symbol" aria-hidden="true">
          ◒
        </span>
      </div>
      <div className="cycle-goal">{workspace.goal}</div>
      <div className="progress-line">
        <progress value={percent} max="100" aria-label="Completed issues" />
        <b>{percent}%</b>
      </div>
    </aside>
  );
}
function Area({ value }) {
  return (
    <span className={'area ' + value.toLowerCase()}>
      <i />
      {value}
    </span>
  );
}
function Card({ issue, edit }) {
  return (
    <button
      className="card"
      onClick={() => edit(issue.id)}
      aria-label={issueKey(issue.id) + ' ' + issue.title}
    >
      <span className="card-top">
        <span className="key">{issueKey(issue.id)}</span>
        {issue.priority === 'High' && (
          <span className="high">
            <span aria-hidden="true">↑</span> High
          </span>
        )}
      </span>
      <strong>{issue.title}</strong>
      <Area value={issue.area} />
    </button>
  );
}
function Editor({ item, onCancel, onSaved, onDelete }) {
  const dialog = useRef(null);
  const [form, setForm] = useState(item);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [deleting, setDeleting] = useState(false);
  useEffect(() => {
    dialog.current.showModal();
  }, []);
  const field = (name) => ({
    value: form[name],
    onChange: (e) => setForm({ ...form, [name]: e.target.value }),
  });
  async function act(fn) {
    setBusy(true);
    setError('');
    try {
      await fn();
    } catch (e) {
      setError(e.message);
      setBusy(false);
    }
  }
  async function save(e) {
    e.preventDefault();
    if (!form.title.trim()) {
      setError('Enter an issue title.');
      return;
    }
    await act(async () => {
      const data = Object.fromEntries(
        Object.keys(blank).map((k) => [k, k === 'title' ? form.title.trim() : form[k]]),
      );
      const saved = await api(
        item.id ? 'issues/' + item.id : 'issues',
        item.id ? 'PATCH' : 'POST',
        data,
      );
      onSaved(saved);
    });
  }
  return (
    <dialog
      ref={dialog}
      aria-labelledby="editor-title"
      onCancel={(e) => {
        e.preventDefault();
        if (!busy) onCancel();
      }}
    >
      <form onSubmit={save}>
        <div className="dialog-head">
          <div>
            <span className="key">{item.id ? issueKey(item.id) : 'ISSUES'}</span>
            <h2 id="editor-title">{item.id ? 'Edit issue' : 'New issue'}</h2>
          </div>
          <button
            type="button"
            className="close"
            onClick={onCancel}
            disabled={busy}
            aria-label="Close dialog"
          >
            ×
          </button>
        </div>
        <label>
          Title
          <input autoFocus required maxLength={160} {...field('title')} />
        </label>
        <label>
          Description
          <textarea rows="3" maxLength={1500} {...field('detail')} />
        </label>
        <div className="fields">
          {[
            ['status', stages],
            ['priority', ['Normal', 'High']],
            ['area', areas],
          ].map(([name, values]) => (
            <label key={name}>
              {name[0].toUpperCase() + name.slice(1)}
              <select {...field(name)}>
                {values.map((v) => (
                  <option key={v}>{v}</option>
                ))}
              </select>
            </label>
          ))}
        </div>
        {error && <p role="alert">{error}</p>}
        {deleting ? (
          <div className="delete-confirm">
            <p>Delete this issue from the board?</p>
            <button type="button" disabled={busy} onClick={() => setDeleting(false)}>
              Keep issue
            </button>
            <button
              type="button"
              className="danger"
              disabled={busy}
              onClick={() =>
                act(async () => {
                  await api('issues/' + item.id, 'DELETE');
                  onDelete(item.id);
                })
              }
            >
              Confirm delete
            </button>
          </div>
        ) : (
          <div className="actions">
            {item.id && (
              <button
                className="delete"
                type="button"
                disabled={busy}
                onClick={() => setDeleting(true)}
              >
                Delete issue
              </button>
            )}
            <button type="button" onClick={onCancel} disabled={busy}>
              Cancel
            </button>
            <button className="primary" disabled={busy}>
              {item.id ? 'Save changes' : 'Create issue'}
            </button>
          </div>
        )}
      </form>
    </dialog>
  );
}
function App() {
  const [issues, setIssues] = useState([]);
  const [workspace, setWorkspace] = useState(null);
  const [query, setQuery] = useState('');
  const [priority, setPriority] = useState('All priorities');
  const [item, setItem] = useState(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const search = useRef(null);
  const trigger = useRef(null);
  useEffect(() => {
    Promise.all([api('issues'), api('workspace')])
      .then(([rows, team]) => {
        setIssues(rows);
        setWorkspace(team);
      })
      .catch((e) => setError(e.message));
  }, []);
  useEffect(() => {
    const shortcut = (e) => {
      if (
        item ||
        e.ctrlKey ||
        e.metaKey ||
        e.altKey ||
        ['INPUT', 'TEXTAREA', 'SELECT'].includes(e.target.tagName)
      )
        return;
      if (e.key === '/') {
        e.preventDefault();
        search.current?.focus();
      }
    };
    window.addEventListener('keydown', shortcut);
    return () => window.removeEventListener('keydown', shortcut);
  }, [item]);
  function closeEditor() {
    setItem(null);
    requestAnimationFrame(() => trigger.current?.isConnected && trigger.current.focus());
  }
  function create(status = 'Backlog') {
    trigger.current = document.activeElement;
    setItem({ ...blank, status });
  }
  async function edit(id) {
    trigger.current = document.activeElement;
    try {
      setItem(await api('issues/' + id));
    } catch (e) {
      setError(e.message);
    }
  }
  const visible = issues.filter(
    (t) =>
      (priority === 'All priorities' || priority === t.priority) &&
      (t.title + ' ' + issueKey(t.id) + ' ' + t.area).toLowerCase().includes(query.toLowerCase()),
  );
  return (
    <>
      <Brand />
      <main className="board-main">
        <div className="hero">
          <div className="intro">
            <div className="crumb">
              Workspace <span>/</span> Issues
            </div>
            <h1>
              Issue board<span>.</span>
            </h1>
            <p>
              {workspace
                ? workspace.team + ' · ' + issues.length + ' issues'
                : 'Loading workspace…'}
            </p>
          </div>
          {workspace && <Progress issues={issues} workspace={workspace} />}
        </div>
        {error && (
          <p className="alert" role="alert">
            {error}
          </p>
        )}
        <div className="tools">
          <label className="search">
            <span aria-hidden="true">⌕</span>
            <input
              ref={search}
              aria-label="Search issues"
              placeholder="Search issues…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
            <kbd>/</kbd>
          </label>
          <label className="filters">
            <span className="sr">Filter by priority</span>
            <select value={priority} onChange={(e) => setPriority(e.target.value)}>
              <option>All priorities</option>
              <option>High</option>
              <option>Normal</option>
            </select>
          </label>
          <button className="primary new" disabled={!workspace} onClick={() => create()}>
            <span aria-hidden="true">＋</span> New issue
          </button>
        </div>
        <div className="lanes">
          {stages.map((stage, i) => {
            const group = visible.filter((t) => t.status === stage);
            return (
              <section key={stage} className={'lane lane-' + i} aria-label={stage}>
                <div className="lane-title">
                  <i aria-hidden="true" />
                  <h2>{stage}</h2>
                  <span className="count">{group.length}</span>
                  <button
                    aria-label={'Add issue to ' + stage}
                    disabled={!workspace}
                    onClick={() => create(stage)}
                  >
                    ＋
                  </button>
                </div>
                <div className="cards">
                  {group.map((issue) => (
                    <Card key={issue.id} issue={issue} edit={edit} />
                  ))}
                  {!group.length && (
                    <p className="empty">
                      {query || priority !== 'All priorities'
                        ? 'No matching issues'
                        : 'No issues here'}
                    </p>
                  )}
                </div>
              </section>
            );
          })}
        </div>
        <div className="board-bottom">
          <span>Relay workspace</span>
          <span>
            {visible.length} of {issues.length} issues
          </span>
        </div>
        <span className="sr" role="status">
          {notice}
        </span>
      </main>
      {item && (
        <Editor
          item={item}
          onCancel={closeEditor}
          onDelete={(id) => {
            setIssues((old) => old.filter((t) => t.id !== id));
            setNotice('Issue deleted');
            closeEditor();
          }}
          onSaved={(row) => {
            setIssues((old) =>
              old.some((t) => t.id === row.id)
                ? old.map((t) => (t.id === row.id ? row : t))
                : [...old, row],
            );
            setNotice('Saved ' + row.title);
            closeEditor();
          }}
        />
      )}
    </>
  );
}
createRoot(document.getElementById('root')).render(<App />);
