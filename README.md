# SpecHatch

Turn a passing Playwright test into a static demo that visitors can actually edit.

SpecHatch starts your seeded app, runs your browser tests, and stops the backend. It packages your frontend with a small browser-side implementation of the API routes you declare. It then runs the **same test files and assertions** against that export. A passing build produces a static folder, a human-readable build receipt, and a resettable sandbox for each visitor.

**Try this in the included Relay issue board:** create an issue with a title of your choice, move it to **Done**, and reload. Your change persists. Open a fresh browser profile and the board starts with the original sample data. Select **Build receipt** to see which workflows passed and which API routes they exercised.

## Run the example

Use Node.js 22.12 or later and npm. On a fresh checkout:

```sh
npm ci
npx playwright install --only-shell chromium
npm run demo
npm run preview
```

Open **http://127.0.0.1:4173**. The preview process serves static files. You can stop and restart it without resetting your browser's data. The sample API ran only while building.

**Release ZIP:** the included `demo/` is already built. Run `node bin/serve.mjs demo` to try it immediately with Node alone. The ZIP also includes the installable CLI tarball in `packages/`. During local development, `SPECHATCH_CHROMIUM_PATH` can point to an installed compatible Chromium executable. On a minimal Linux installation use `npx playwright install --with-deps --only-shell chromium`.

## When it fits

Use SpecHatch for a client-rendered issue tracker, catalog, admin console, or similar app whose public demo workflows use a small same-origin JSON API. The first integration is a good fit when you already have a reproducible seed and a Playwright test that opens the UI and asserts a visible result.

| Maintainer supplies | Visitor gets |
|---|---|
| A production frontend build with relative asset URLs | The actual frontend running in their browser |
| A local command that serves the frontend and a disposable seeded API | A static site that can be hosted separately |
| A browser test and an explicit API field and operation list | Editable sample data, reload persistence, and reset |
| Expected UI assertions | A build receipt with the results from both environments |

## Use it with another repo

1. In the SpecHatch checkout, run `npm ci` and `npm pack`. Install the resulting tarball as a dev dependency in your app alongside its existing `@playwright/test`. For example, `npm install -D ../spechatch/spechatch-0.1.0.tgz`.
2. Build your frontend. Configure relative asset paths. For Vite, use `vite build --base=./`.
3. Create `spechatch.config.mjs` in your app. Your start command must read `process.env.SPECHATCH_PORT`, bind to loopback, serve the frontend and API together, and expose a readiness endpoint.
4. Run `npx --no-install spechatch build --out ./demo`. Use `npx --no-install spechatch verify --out ./demo` to validate the bytes and rerun the selected tests later.
5. Serve the output directory over HTTPS or localhost. The browser needs a secure context for its service worker.

A small configuration for a list of tasks:

```js
export default {
  name: 'Tasks',
  buildDir: './dist',
  testDir: './tests',
  testMatch: 'tasks.spec.ts',
  server: { command: ['node', 'demo-server.mjs'], readyPath: '/health' },
  resources: [{
    path: '/api/tasks',
    fields: { id: 'number', title: 'string', done: 'boolean' },
    writable: ['title', 'done'],
    required: ['title', 'done'],
    defaults: { done: false },
    operations: ['list', 'get', 'create', 'update', 'delete']
  }]
};
```

The CLI resolves config paths relative to that file and `--out` relative to the working directory. It generates a single-worker Chromium configuration and resolves the test runner from the consuming project. Tests keep their regular Playwright imports. Write them to use the provided `baseURL`. Project-specific setup from an existing Playwright configuration, multi-user authentication, and direct calls from test code to backend services need separate integration work. The page's API and application code should execute their normal paths during verification.

For a working example see [Relay's configuration](examples/relay/spechatch.config.mjs) and [its unmodified two-pass spec](examples/relay/tests/board.spec.ts). A [second fixture](tests/fixtures/catalog) demonstrates a plain JavaScript app with a read-only API and a different URL prefix.

## What the browser implements

| Request | Behavior |
|---|---|
| `GET /collection` | Reads seeded rows and visitor edits. Optional exact-match query keys come from `filterBy`. |
| `GET /collection/:id` | Reads a single record by its configured primary key. |
| `POST /collection` | Validates writable fields and defaults, then allocates an integer or UUID. |
| `PATCH /collection/:id` | Updates writable fields and preserves other fields. |
| `DELETE /collection/:id` | Removes the record and returns HTTP 204. |
| Configured `reads` | Returns selected scalar fields of a captured JSON object. |

Each collection GET must initially return a full, unpaginated array. A declared read returns one flat object. Fields support strings, numbers, booleans and string enums. Set `key` for a custom ID column and `id: 'uuid'` to generate string IDs. Only declared operations are enabled. Unknown routes, methods and query shapes return HTTP 501 and display a short message in the demo. Multi-record business transactions, file uploads, SSR, WebSockets, OAuth and GraphQL are outside the current adapter. Your tests determine how much of the app a receipt covers.

All seed reads happen before live tests mutate the disposable backend. Only allowlisted scalar fields enter the contract. Request headers, cookies, response headers and raw traffic recordings are excluded. The frontend bundle itself is shipped to visitors, so use public assets and synthetic data. An allowlisted title or description is public too.

## What a passing build proves

- The selected tests passed on a real seeded backend, without retries, skips or expected failures.
- SpecHatch stopped the managed server and checked its listener had closed.
- The same test identities and source hashes passed against static files in fresh browser contexts. Browser-network egress in replay is restricted to a loopback static server. Unsupported API calls fail the build even if the UI catches their errors.
- At least one declared API route was exercised. The receipt lists method and route counts, live and replay durations, source locations and build ID.
- Exported files have a SHA-256 inventory. A later `verify` checks the file set and bytes before running tests. The receipt records local build results. It carries no digital signature.

The staged build replaces the last good output only after verification passes. A build lock protects concurrent publication. The CLI refuses to replace an unrecognized or modified output directory. If a machine terminates mid-build, inspect its sibling `.spechatch-*` staging directory and `.spechatch-lock` directory before starting another build.

Each scope and build has its own IndexedDB state. Writes run in transactions across tabs. Reset clears this demo's local records. A new build ID starts a fresh sandbox. The service worker caches bundled assets on first load, so supported workflows can continue after the network disconnects. The receipt JSON can also be read offline after it has been opened online.

## GitHub Pages and CI

The included [workflow](.github/workflows/check.yml) verifies public-repository pushes to main and pull requests on a standard Ubuntu runner. Its job summary includes a receipt, and its downloadable demo artifact expires after one day. The local CLI needs no account, API key, hosted database, AI model or paid API.

To host the example on GitHub Pages, select **Settings → Pages → Source → GitHub Actions** on a public repository. In **Actions → Verify demo → Run workflow**, enable **Publish the verified example**. To publish each passing main-branch build, set the repository Actions variable `SPECHATCH_PAGES=true`. The deployment job depends on verification and runs only on main. The sample verifies at a nested URL so relative assets and scope are exercised before deployment.

GitHub documents Pages availability for public repositories on its Free plan and the billing rules for standard public-repository runners. [GitHub Pages](https://docs.github.com/en/pages/getting-started-with-github-pages/what-is-github-pages) · [Actions billing](https://docs.github.com/en/billing/concepts/product-billing/github-actions)

## Development

```sh
npm test                 # config, capture, state machine, output preservation
npm run demo             # compile, build Relay, run the two-pass gate
npm run test:browser     # offline, isolation, concurrent writes and failure cases
npm run verify           # independent byte check and static rerun
npm run check            # all of the above
```

The exporter lives in [src](src), the browser implementation in [runtime](runtime), and the sample in [examples/relay](examples/relay). The two separate REST implementations are intentional. The live backend and sandbox must agree on the behavior the test actually observes.

MIT licensed. The bundled example includes its third-party license notices.
