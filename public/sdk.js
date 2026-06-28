(function (global) {
  var script = document.currentScript;
  var origin = script ? new URL(script.src).origin : location.origin;
  var state = { user: null, attributes: {}, shown: {} };

  function showSurvey(slug, options) {
    options = options || {};
    if (!slug) throw new Error('FeedbackOS survey slug is required.');
    if (options.oncePerSession && state.shown[slug]) return null;
    state.shown[slug] = true;

    var overlay = document.createElement('div');
    overlay.style.cssText = 'position:fixed;inset:0;z-index:2147483000;background:rgba(32,51,47,.42);display:grid;place-items:center;padding:20px;';
    var shell = document.createElement('div');
    shell.style.cssText = 'width:min(760px,100%);height:min(820px,92vh);background:#fff;border-radius:8px;overflow:hidden;box-shadow:0 24px 70px rgba(0,0,0,.25);position:relative;';
    var close = document.createElement('button');
    close.type = 'button';
    close.textContent = 'Close';
    close.style.cssText = 'position:absolute;right:10px;top:10px;z-index:2;border:0;border-radius:8px;background:#20332f;color:#fff;padding:8px 10px;font:600 13px system-ui;';
    var iframe = document.createElement('iframe');
    iframe.title = 'FeedbackOS in-app survey';
    iframe.src = origin + '/s/' + encodeURIComponent(slug) + '?source=in-app';
    iframe.style.cssText = 'width:100%;height:100%;border:0;';
    close.addEventListener('click', function () {
      overlay.remove();
    });
    shell.appendChild(close);
    shell.appendChild(iframe);
    overlay.appendChild(shell);
    document.body.appendChild(overlay);
    return overlay;
  }

  function identify(userId, attributes) {
    state.user = userId;
    state.attributes = attributes || {};
    return state;
  }

  function frequencyAllowed(slug, frequencyDays) {
    var days = Number(frequencyDays || 0);
    if (!days) return true;
    var key = 'feedbackos:lastShown:' + slug;
    var last = Number(global.localStorage && global.localStorage.getItem(key) || 0);
    return !last || Date.now() - last > days * 24 * 60 * 60 * 1000;
  }

  function rememberShown(slug) {
    try {
      global.localStorage && global.localStorage.setItem('feedbackos:lastShown:' + slug, String(Date.now()));
    } catch {}
  }

  function trigger(eventName, payload) {
    var detail = { eventName: eventName, payload: payload || {}, user: state.user, attributes: state.attributes };
    global.dispatchEvent(new CustomEvent('feedbackos:event', { detail: detail }));
    fetch(origin + '/api/public/in-app/resolve', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        eventName: eventName,
        payload: payload || {},
        userId: state.user,
        attributes: state.attributes,
        path: global.location ? global.location.pathname : ''
      })
    })
      .then(function (response) { return response.ok ? response.json() : { survey: null }; })
      .then(function (result) {
        if (!result.survey || !result.survey.slug) return;
        if (!frequencyAllowed(result.survey.slug, result.survey.frequencyDays)) return;
        var overlay = showSurvey(result.survey.slug, { oncePerSession: true });
        if (overlay) rememberShown(result.survey.slug);
      })
      .catch(function () {});
    return detail;
  }

  global.FeedbackOS = {
    identify: identify,
    trigger: trigger,
    showSurvey: showSurvey
  };
})(window);
