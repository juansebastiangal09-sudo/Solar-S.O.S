(function () {
  "use strict";
  var $ = function (id) { return document.getElementById(id); };
  var lerp = function (a, b, t) { return Math.round(a + (b - a) * t); };
  var mix = function (c1, c2, t) {
    return "rgb(" + lerp(c1[0], c2[0], t) + "," + lerp(c1[1], c2[1], t) + "," + lerp(c1[2], c2[2], t) + ")";
  };

  /* ===== 1. Simulador: un día de sol ===== */
  var PANEL_W = 200, HSP = 4, PR = 0.7;
  var K = HSP * Math.PI / 24; // kW/m² pico para que el día sume HSP

  function irr(h) { // irradiancia 6:00–18:00
    if (h <= 6 || h >= 18) return 0;
    return K * Math.sin(Math.PI * (h - 6) / 12);
  }
  function energy(h) { // Wh acumulados hasta h
    if (h <= 6) return 0;
    var e = Math.min(h, 18);
    var integral = (12 / Math.PI) * (1 - Math.cos(Math.PI * (e - 6) / 12));
    return PANEL_W * PR * K * integral;
  }
  function fmtHora(h) {
    var hh = Math.floor(h), mm = Math.round((h - hh) * 60);
    return String(hh).padStart(2, "0") + ":" + String(mm).padStart(2, "0");
  }

  var NIGHT_TOP = [12, 35, 64], NIGHT_BOT = [38, 60, 95];
  var DAY_TOP = [142, 205, 240], DAY_BOT = [223, 242, 251];

  function updateSim() {
    var h = parseFloat($("hora").value);
    var p = PANEL_W * PR * (irr(h) / K) ; // pico = PANEL_W*PR
    var light = irr(h) / K; // 0..1
    var t = Math.min(1, light * 1.6);
    var root = document.documentElement.style;
    root.setProperty("--sky-top", mix(NIGHT_TOP, DAY_TOP, t));
    root.setProperty("--sky-bot", mix(NIGHT_BOT, DAY_BOT, t));
    document.body.classList.toggle("night", t < 0.45);

    var frac = (h - 5) / 14;
    var sun = $("sun");
    sun.style.left = "calc(" + (frac * 100) + "% - 42px)";
    sun.style.top = (62 - Math.sin(Math.PI * frac) * 50) + "%";
    sun.style.opacity = h > 5.5 && h < 18.5 ? 1 : 0.15;

    $("horaTxt").textContent = fmtHora(h);
    $("outP").textContent = Math.round(p) + " W";
    $("outE").textContent = Math.round(energy(h)) + " Wh";
    $("outS").textContent = p > 100 ? "Cargando a tope"
      : p > 5 ? "Cargando batería"
      : h >= 18 ? "Usando lo almacenado" : "Esperando el sol";
  }
  $("hora").addEventListener("input", updateSim);
  updateSim();

  /* ===== 2. Flujo de energía con dos niveles ===== */
  var STAGES = [
    { t: "Panel solar",
      g: "Es como la lluvia que llena un tanque: capta la luz del sol y la convierte en electricidad.",
      x: "Capta radiación y entrega tensión DC variable según la irradiancia. Se mide la tensión de entrada Panel → Controlador." },
    { t: "Controlador de carga",
      g: "Es la válvula del tanque: decide cuánta energía entra a la batería para que no se llene de más.",
      x: "Regula la carga por etapas (bulk, absorción, flotación) con umbrales ajustados para VRLA/AGM y protege la vida útil." },
    { t: "Batería",
      g: "Es el tanque donde se guarda la energía para usarla cuando no hay sol ni red.",
      x: "Banco VRLA/AGM con profundidad de descarga (DoD) limitada y corte por subtensión; sustituye a LiFePO4 por falta de stock." },
    { t: "Inversor SPWM",
      g: "Es la bomba que entrega la energía con la forma correcta para tus aparatos, suave y limpia.",
      x: "Puente H con MOSFETs gobernado por EGS002 (SPWM) y filtro LC; la onda senoidal pura se verifica con osciloscopio." },
    { t: "Tus dispositivos",
      g: "Son las llaves de agua: conectas el celular, la tableta o el portátil y se cargan con normalidad.",
      x: "Cargas AC por el inversor y cargas DC directas desde la batería; probado con dispositivos reales conectados." }
  ];
  var aud = "gen", cur = 0;

  function renderStage() {
    $("dT").textContent = (cur + 1) + ". " + STAGES[cur].t;
    $("dP").textContent = STAGES[cur][aud === "gen" ? "g" : "x"];
    document.querySelectorAll("#flow button").forEach(function (b) {
      b.classList.toggle("on", +b.dataset.i === cur);
    });
  }
  $("flow").addEventListener("click", function (e) {
    var b = e.target.closest("button");
    if (!b) return;
    cur = +b.dataset.i;
    renderStage();
  });
  document.querySelectorAll(".seg").forEach(function (b) {
    b.addEventListener("click", function () {
      aud = b.dataset.aud;
      document.querySelectorAll(".seg").forEach(function (s) {
        var on = s === b;
        s.classList.toggle("on", on);
        s.setAttribute("aria-pressed", on);
      });
      renderStage();
    });
  });
  renderStage();

  /* ===== 3. Calculadora de autonomía ===== */
  var ids = ["cP", "cH", "cPR", "cV", "cAh", "cD", "cE", "cL"];
  function num(id) { return parseFloat($(id).value); }
  function fmtH(h) {
    if (!isFinite(h)) return "–";
    var hh = Math.floor(h), mm = Math.round((h - hh) * 60);
    return hh + " h " + mm + " min";
  }
  function calc() {
    var v = ids.map(num);
    if (v.some(function (x) { return !isFinite(x) || x <= 0; })) {
      ["rGen", "rUtil", "rAut", "rRec"].forEach(function (r) { $(r).textContent = "–"; });
      $("rTxt").textContent = "Completa todos los campos con números mayores que cero.";
      return;
    }
    var gen = v[0] * v[1] * (v[2] / 100);
    var util = v[3] * v[4] * (v[5] / 100) * (v[6] / 100);
    var aut = util / v[7];
    var rec = (v[3] * v[4] * (v[5] / 100)) / gen;
    $("rGen").textContent = Math.round(gen) + " Wh";
    $("rUtil").textContent = Math.round(util) + " Wh";
    $("rAut").textContent = fmtH(aut);
    $("rRec").textContent = rec.toFixed(1) + " días";
    $("rTxt").textContent = "Con " + v[7] + " W conectados, la estación aguanta unas " +
      fmtH(aut) + " y se recarga en cerca de " + rec.toFixed(1) + " días de sol.";
  }
  ids.forEach(function (id) { $(id).addEventListener("input", calc); });
  calc();

  /* ===== 4. Buscador de glosario ===== */
  $("q").addEventListener("input", function () {
    var q = this.value.trim().toLowerCase(), shown = 0;
    document.querySelectorAll("#glos details").forEach(function (d) {
      var hit = !q || (d.dataset.k + " " + d.textContent).toLowerCase().indexOf(q) > -1;
      d.hidden = !hit;
      if (hit) shown++;
      d.open = !!q && hit;
    });
    $("noRes").hidden = shown > 0;
  });
})();

/* ===== 5. Juego de aparatos y quiz ===== */
(function () {
  "use strict";
  var $ = function (id) { return document.getElementById(id); };
  function usable() {
    var f = function (id) { return parseFloat($(id).value) || 0; };
    return f("cV") * f("cAh") * (f("cD") / 100) * (f("cE") / 100);
  }
  function fmtH(h) { return Math.floor(h) + " h " + Math.round((h % 1) * 60) + " min"; }
  function game() {
    var W = 0, n = 0;
    document.querySelectorAll("#chips button").forEach(function (b) {
      if (b.getAttribute("aria-pressed") === "true") { W += +b.dataset.w; n++; }
    });
    var bar = $("bar"), txt = $("gTxt");
    if (!n) { bar.style.width = "0"; txt.textContent = "Elige al menos un aparato."; return; }
    var h = usable() / W;
    bar.style.width = Math.min(100, h / 24 * 100) + "%";
    bar.style.background = h >= 8 ? "#1f8a70" : h >= 3 ? "#ffb703" : "#d9480f";
    txt.textContent = "Consumes " + W + " W y la batería aguanta unas " + fmtH(h) + "." +
      (h >= 8 ? " ¡Una jornada completa!" : h >= 3 ? " Alcanza para varias horas." : " Poco tiempo: quita algún aparato.");
  }
  $("chips").addEventListener("click", function (e) {
    var b = e.target.closest("button"); if (!b) return;
    b.setAttribute("aria-pressed", b.getAttribute("aria-pressed") !== "true");
    game();
  });
  ["cV", "cAh", "cD", "cE"].forEach(function (id) { $(id).addEventListener("input", game); });

  var Q = [
    { q: "¿Qué hace el controlador de carga?", o: ["Convierte DC en AC", "Cuida la batería repartiendo la carga por etapas", "Capta la luz del sol"], a: 1, e: "Es el guardián de la batería: evita sobrecargas y alarga su vida." },
    { q: "¿Qué tipo de corriente entrega un panel solar?", o: ["DC (continua)", "AC (alterna)", "Ninguna"], a: 0, e: "Paneles y baterías trabajan en DC. Por eso hace falta el inversor para los aparatos AC." },
    { q: "¿Por qué la onda senoidal pura es importante?", o: ["Hace la luz más brillante", "Protege equipos sensibles como portátiles", "Gasta más energía"], a: 1, e: "Es una onda limpia, igual a la de la red, y no daña los aparatos delicados." },
    { q: "¿Por qué usamos baterías VRLA/AGM?", o: ["No había LiFePO4 disponibles en el mercado local", "Son las más modernas", "No necesitan controlador"], a: 0, e: "Nos adaptamos: limitamos la descarga y ajustamos la carga para usarlas con seguridad." }
  ];
  var i = 0, score = 0, box = $("quiz");
  function show() {
    if (i >= Q.length) {
      box.innerHTML = '<p class="q">Sacaste ' + score + ' de ' + Q.length + (score === Q.length ? ' 🌞 ¡Experto solar!' : score >= 2 ? ' ⚡ ¡Muy bien!' : ' 🌱 Repasa el sistema y vuelve a intentar') + '</p><button class="next" id="again">Jugar de nuevo</button>';
      $("again").onclick = function () { i = 0; score = 0; show(); };
      return;
    }
    var d = Q[i];
    box.innerHTML = '<p class="step">Pregunta ' + (i + 1) + ' de ' + Q.length + '</p><p class="q">' + d.q + '</p>' +
      d.o.map(function (t, k) { return '<button class="opt" data-k="' + k + '">' + t + '</button>'; }).join("") + '<div id="fb"></div>';
    box.querySelectorAll(".opt").forEach(function (b) {
      b.onclick = function () {
        var k = +b.dataset.k, ok = k === d.a;
        if (ok) score++;
        box.querySelectorAll(".opt").forEach(function (x) {
          x.disabled = true;
          if (+x.dataset.k === d.a) x.classList.add("ok");
        });
        if (!ok) b.classList.add("no");
        $("fb").innerHTML = '<p class="fb"><strong>' + (ok ? "¡Correcto! " : "Casi. ") + '</strong>' + d.e + '</p><button class="next" id="nx">' + (i === Q.length - 1 ? "Ver resultado" : "Siguiente") + '</button>';
        $("nx").onclick = function () { i++; show(); };
        $("nx").focus();
      };
    });
  }
  show();
})();
