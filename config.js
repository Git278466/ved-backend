// VED Foundation — API Configuration
window.VED_API_BASE = (function () {
  var h = location.hostname;

  // Local development — 127.0.0.1 avoids Windows localhost/IPv6 DNS delay
  if (h === 'localhost' || h === '127.0.0.1') {
    return 'http://127.0.0.1:5000/api';
  }

  // Production — use relative API path so frontend works with the deployed backend proxy
  return '/api';
}());
