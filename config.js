// VED Foundation — API Configuration
window.VED_API_BASE = (function () {
  var h = location.hostname;

  // Local development
  if (h === 'localhost' || h === '127.0.0.1') {
    return 'http://localhost:5000/api';
  }

  // Production — use relative API path so frontend works with the deployed backend proxy
  return '/api';
}());
