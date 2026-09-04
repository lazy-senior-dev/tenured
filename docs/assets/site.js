/* lazy-senior-dev shared behaviour: theme toggle, mobile menu, copy buttons, reveal on scroll, terminal typing. */
(function () {
  var root = document.documentElement;
  function setTheme(t) { root.setAttribute("data-theme", t); try { localStorage.setItem("lsd-theme", t); } catch (e) {} var b = document.getElementById("theme"); if (b) b.textContent = t === "dark" ? "☀" : "☾"; }
  var saved = null; try { saved = localStorage.getItem("lsd-theme"); } catch (e) {}
  var forced = (location.search.match(/[?&]theme=(dark|light)/) || [])[1];
  setTheme(forced || saved || "light");
  var tb = document.getElementById("theme");
  if (tb) tb.addEventListener("click", function () { setTheme(root.getAttribute("data-theme") === "dark" ? "light" : "dark"); });
  var mb = document.getElementById("menu");
  if (mb) mb.addEventListener("click", function () { document.querySelector(".top").classList.toggle("open"); });

  document.querySelectorAll("[data-copy]").forEach(function (btn) {
    btn.addEventListener("click", function () {
      var text = btn.parentElement.querySelector("pre").textContent;
      var done = function () { btn.textContent = "Copied"; setTimeout(function () { btn.textContent = "Copy"; }, 1400); };
      if (navigator.clipboard) navigator.clipboard.writeText(text).then(done, done); else done();
    });
  });

  var items = document.querySelectorAll(".reveal");
  if ("IntersectionObserver" in window) {
    var io = new IntersectionObserver(function (es) { es.forEach(function (e) { if (e.isIntersecting) { e.target.classList.add("in"); io.unobserve(e.target); } }); }, { rootMargin: "0px 0px -8% 0px" });
    items.forEach(function (el) { io.observe(el); });
  } else items.forEach(function (el) { el.classList.add("in"); });

  var body = document.getElementById("term-body");
  if (body && window.TERM_SCRIPT) {
    var script = window.TERM_SCRIPT;
    var reduced = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    function esc(s) { return s.replace(/&/g, "&amp;").replace(/</g, "&lt;"); }
    function render(lines, typing) {
      body.innerHTML = lines.map(function (l, i) {
        var cls = (l.c || "") + (typing && i === lines.length - 1 ? " cursor" : "");
        return "<span" + (cls.trim() ? ' class="' + cls.trim() + '"' : "") + ">" + esc(l.t) + "</span>";
      }).join("\n");
    }
    if (reduced) { render(script, false); return; }
    (function play() {
      var shown = [], i = 0;
      (function step() {
        if (i >= script.length) { setTimeout(function () { shown = []; i = 0; step(); }, 6000); return; }
        var line = script[i];
        if (line.type) {
          var k = 0; shown.push({ t: "", c: line.c });
          (function typeChar() { shown[shown.length - 1].t = line.t.slice(0, ++k); render(shown, true); if (k < line.t.length) setTimeout(typeChar, 26); else { i++; setTimeout(step, 450); } })();
        } else { shown.push(line); render(shown, false); i++; setTimeout(step, line.t === "" ? 220 : (line.c === "block" || line.c === "ok") ? 900 : 620); }
      })();
    })();
  }
})();
