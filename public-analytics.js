// Public site identifier, not an API credential. No custom events or form content.
(() => {
  'use strict';
  if (location.hostname !== 'charlesy520.github.io' ||
      !location.pathname.startsWith('/pet-food-data-studio-public/') ||
      navigator.doNotTrack === '1' || window.doNotTrack === '1') return;
  const script = document.createElement('script');
  script.type = 'module';
  script.async = true;
  script.src = 'https://static.cloudflareinsights.com/beacon.min.js';
  script.setAttribute('data-cf-beacon', JSON.stringify({
    token: '200fa376e4c945b28cae020f2a748621', spa: false
  }));
  document.head.appendChild(script);
})();
