/**
 * Fycloak – Script de recebimento de token (Google Ads)
 * Injete na black page. Config: window.FYCLOAK_RECEIPT_CONFIG = { apiBase, campaignSlug, requireToken }.
 * Se requireToken === false: mostra conteúdo. Senão: com token chama /validate; sem token chama /validate-session (visitor_id via FingerprintJS Open Source).
 */
(function () {
  'use strict';
  var C = window.FYCLOAK_RECEIPT_CONFIG;
  if (!C || !C.apiBase) return;
  var apiBase = C.apiBase.replace(/\/$/, '');
  var campaignSlug = (C.campaignSlug != null && C.campaignSlug !== '') ? String(C.campaignSlug) : '';
  var campaignId = (C.campaignId != null && C.campaignId !== '' && !isNaN(Number(C.campaignId))) ? Number(C.campaignId) : null;
  var requireToken = C.requireToken !== false;
  if (typeof console !== 'undefined' && console.log) console.log('[fycloak] black page init', campaignSlug, 'campaignId=', campaignId, 'requireToken=', requireToken);

  function getCookie(name) {
    var v = document.cookie.match('(?:^|; )\\s*' + name.replace(/\W/g, '\\$&') + '\\s*=\\s*([^;]*)');
    return v ? decodeURIComponent(v[1]) : null;
  }
  function clearCookie(name) {
    document.cookie = name + '=; path=/; max-age=0';
  }
  function setValid(valid) {
    if (typeof document.body.classList !== 'undefined') {
      document.body.classList.add(valid ? 'fycloak-valid' : 'fycloak-invalid');
    } else {
      var terms = document.getElementById('terms');
      var content = document.getElementById('content');
      if (terms) terms.style.display = valid ? 'none' : 'block';
      if (content) content.style.display = valid ? 'block' : 'none';
    }
  }

  if (!requireToken) {
    if (typeof console !== 'undefined' && console.log) console.log('[fycloak] requireToken=false, showing content');
    setValid(true);
    return;
  }

  function getVisitorId() {
    if (window.FingerprintJS && typeof window.FingerprintJS.load === 'function') {
      return window.FingerprintJS.load({ monitoring: false })
        .then(function (fp) { return fp.get(); })
        .then(function (result) { return result && result.visitorId ? result.visitorId : ''; })
        .catch(function () { return ''; });
    }
    return Promise.resolve('');
  }

  var params = new URLSearchParams(window.location.search);
  var token = params.get('token') || getCookie('fycloak_token');

  function done(valid) {
    if (token) clearCookie('fycloak_token');
    if (valid && token && window.history && window.history.replaceState) {
      var u = window.location.href.replace(/[?&]token=[^&]+/, '').replace(/\?&/, '?').replace(/\?$/, '');
      if (u !== window.location.href) window.history.replaceState({}, '', u);
    }
    setValid(valid);
  }

  if (!token) {
    if (typeof console !== 'undefined' && console.log) console.log('[fycloak] no token, calling /validate-session');
    getVisitorId().then(function (visitorId) {
      var q = 'visitor_id=' + encodeURIComponent(visitorId) + '&campaign_slug=' + encodeURIComponent(campaignSlug);
      if (campaignId != null) q += '&campaign_id=' + encodeURIComponent(String(campaignId));
      return fetch(apiBase + '/validate-session?' + q, { method: 'GET', mode: 'cors' }).then(function (r) { return r.json(); });
    }).then(function (data) {
      if (typeof console !== 'undefined' && console.log) console.log('[fycloak] validate-session result', data && data.valid ? 'valid' : 'invalid');
      done(data && data.valid === true);
    }).catch(function () {
      if (typeof console !== 'undefined' && console.log) console.log('[fycloak] validate-session failed');
      done(false);
    });
    return;
  }

  if (typeof console !== 'undefined' && console.log) console.log('[fycloak] has token, calling /validate');
  getVisitorId().then(function (visitorId) {
    var q = 'token=' + encodeURIComponent(token) + '&campaign_slug=' + encodeURIComponent(campaignSlug);
    if (campaignId != null) q += '&campaign_id=' + encodeURIComponent(String(campaignId));
    if (visitorId) q += '&visitor_id=' + encodeURIComponent(visitorId);
    return fetch(apiBase + '/validate?' + q, { method: 'GET', mode: 'cors' }).then(function (r) { return r.json(); });
  }).then(function (data) {
    if (typeof console !== 'undefined' && console.log) console.log('[fycloak] validate result', data && data.valid ? 'valid' : 'invalid');
    done(data && data.valid === true);
  }).catch(function () {
    if (typeof console !== 'undefined' && console.log) console.log('[fycloak] validate failed');
    clearCookie('fycloak_token');
    done(false);
  });
})();
