// The shell calls this (WebviewWindow::eval) when the in-process server could not start.
  window.tncStartupFailed = function (text) {
    document.getElementById('msg').textContent = 'The local server could not start.';
    var e = document.getElementById('err'); e.textContent = text; e.style.display = 'block';
  };
