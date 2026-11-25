// Install before application scripts so even a swallowed CSP failure is reported during verification.
document.addEventListener('securitypolicyviolation', (event) => {
  navigator.serviceWorker.controller?.postMessage({
    type: 'spechatch:policy',
    directive: event.effectiveDirective,
  });
});
