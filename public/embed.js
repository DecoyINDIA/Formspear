(function () {
  var script = document.currentScript;
  var slug = script && script.getAttribute('data-feedbackos-slug');
  var mode = (script && script.getAttribute('data-feedbackos-mode')) || 'inline';
  var origin = new URL(script.src).origin;
  if (!slug) return;

  function makeFrame() {
    var iframe = document.createElement('iframe');
    iframe.src = origin + '/s/' + encodeURIComponent(slug);
    iframe.title = 'FeedbackOS survey';
    iframe.loading = 'lazy';
    iframe.style.width = '100%';
    iframe.style.minHeight = mode === 'popup' ? '72vh' : '680px';
    iframe.style.border = '0';
    iframe.style.borderRadius = '8px';
    iframe.style.background = '#fff';
    return iframe;
  }

  if (mode === 'popup' || mode === 'slide-in' || mode === 'button') {
    var button = document.createElement('button');
    button.type = 'button';
    button.textContent = script.getAttribute('data-feedbackos-label') || 'Share feedback';
    button.style.cssText = 'position:fixed;right:18px;bottom:18px;z-index:2147483000;border:0;border-radius:8px;background:#176B5B;color:#fff;padding:12px 14px;font:600 14px system-ui;box-shadow:0 12px 30px rgba(0,0,0,.2);';
    var panel = document.createElement('div');
    panel.style.cssText = 'display:none;position:fixed;right:18px;bottom:72px;width:min(720px,calc(100vw - 36px));height:min(760px,calc(100vh - 100px));z-index:2147483000;background:#fff;border:1px solid #ded6c7;border-radius:8px;box-shadow:0 20px 60px rgba(0,0,0,.24);overflow:hidden;';
    panel.appendChild(makeFrame());
    button.addEventListener('click', function () {
      panel.style.display = panel.style.display === 'none' ? 'block' : 'none';
    });
    document.body.appendChild(panel);
    document.body.appendChild(button);
    return;
  }

  var mount = document.createElement('div');
  mount.setAttribute('data-feedbackos-mounted', slug);
  mount.appendChild(makeFrame());
  script.parentNode.insertBefore(mount, script.nextSibling);
})();
