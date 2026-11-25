const base = new URL('../', import.meta.url);
const bar = document.createElement('aside');
bar.setAttribute('aria-label', 'SpecHatch sandbox');
bar.className = 'spechatch-bar';
bar.innerHTML =
  '<span class="sh-word">◩ &nbsp;SpecHatch</span><span class="sh-status">Local sandbox</span><span class="sh-space"></span><button type="button">Reset demo</button><a>Build receipt ↗</a>';
bar.querySelector('a').href = new URL('__spechatch/receipt.html', base);
bar.querySelector('button').addEventListener('click', async (event) => {
  if (!confirm('Reset this demo to its sample data in this browser?')) return;
  const button = event.currentTarget;
  button.disabled = true;
  try {
    const channel = new MessageChannel();
    const done = new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(Error('Reset timed out.')), 5000);
      channel.port1.onmessage = (e) => {
        clearTimeout(timeout);
        e.data?.ok ? resolve() : reject(Error('Reset failed.'));
      };
    });
    navigator.serviceWorker.controller.postMessage({ type: 'spechatch:reset' }, [channel.port2]);
    await done;
    location.reload();
  } catch (error) {
    button.textContent = error.message;
    button.disabled = false;
  }
});
const notice = document.createElement('div');
notice.className = 'spechatch-notice';
notice.setAttribute('role', 'status');
notice.hidden = true;
let dismiss;
function unavailable() {
  notice.textContent = 'This action is outside the demo. Your local changes are still saved.';
  notice.hidden = false;
  clearTimeout(dismiss);
  dismiss = setTimeout(() => {
    notice.hidden = true;
  }, 7000);
}
navigator.serviceWorker.addEventListener('message', (event) => {
  if (
    event.source === navigator.serviceWorker.controller &&
    event.data?.type === 'spechatch:unavailable'
  )
    unavailable();
});
document.addEventListener('securitypolicyviolation', unavailable);
document.body.append(notice, bar);
navigator.serviceWorker
  .getRegistration(base)
  .then((reg) => reg?.update())
  .catch(() => {});
