const status = document.querySelector('[role=status]');
async function start() {
  if (!window.isSecureContext || !navigator.serviceWorker)
    throw Error('Open this demo over HTTPS or a localhost web server.');
  const base = new URL('../', import.meta.url);
  const registration = await navigator.serviceWorker.register(new URL('spechatch-sw.js', base), {
    type: 'module',
    scope: base.pathname,
    updateViaCache: 'none',
  });
  const controlled = () =>
    navigator.serviceWorker.controller?.scriptURL === new URL('spechatch-sw.js', base).href;
  if (!controlled()) {
    await new Promise((resolve, reject) => {
      const timer = setTimeout(
        () =>
          reject(
            Error('The demo could not start. Reload online and check browser storage permissions.'),
          ),
        25000,
      );
      function ready() {
        if (!controlled()) return;
        clearTimeout(timer);
        navigator.serviceWorker.removeEventListener('controllerchange', ready);
        resolve();
      }
      navigator.serviceWorker.addEventListener('controllerchange', ready);
      ready();
      if (registration.installing)
        registration.installing.addEventListener('statechange', (e) => {
          if (e.target.state === 'redundant' && !controlled()) {
            clearTimeout(timer);
            reject(Error('A bundled file could not be cached. Check the static host.'));
          }
        });
    });
  }
  location.reload();
}
start().catch((err) => {
  status.textContent = err.message;
});
