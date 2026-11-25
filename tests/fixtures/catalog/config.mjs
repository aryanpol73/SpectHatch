export default {
  name: 'Catalog',
  buildDir: 'web',
  testDir: 'spec',
  testMatch: 'catalog.spec.ts',
  apiPrefix: '/v2',
  reads: [{ path: '/v2/book', fields: ['title'] }],
  server: { command: ['node', 'jobs.mjs'], readyPath: '/ready' },
};
