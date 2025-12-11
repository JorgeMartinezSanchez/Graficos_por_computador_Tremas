// main.js — Tremas aleatorias (part 4)
(() => {
  const canvas = document.getElementById("glcanvas");
  const gl = canvas.getContext("webgl", { antialias: true });
  if (!gl) { alert("WebGL no soportado"); return; }

  // --- Programas/shaders
  const prog = initShaders(gl, "tremas-vertex-shader", "tremas-fragment-shader");
  gl.useProgram(prog);

  // --- atributos / uniforms
  const attribs = {
    a_position: gl.getAttribLocation(prog, "a_position"),
    a_color: gl.getAttribLocation(prog, "a_color"),
    a_level: gl.getAttribLocation(prog, "a_level")
  };
  const uniforms = {
    u_mvp: gl.getUniformLocation(prog, "u_mvp"),
    u_time: gl.getUniformLocation(prog, "u_time"),
    u_pointSize: gl.getUniformLocation(prog, "u_pointSize"),
    u_speed: gl.getUniformLocation(prog, "u_speed")
  };

  // --- buffers
  const posBuffer = gl.createBuffer();
  const colorBuffer = gl.createBuffer();
  const levelBuffer = gl.createBuffer();

  // blending
  gl.enable(gl.BLEND);
  gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);

  // params (UI)
  const params = {
    depth: 4,
    density: 0.4,
    baseRadius: 0.18,
    samples: 20000,
    speed: 0.6,
    pointSize: 6.0
  };

  // UI bindings
  function bind(id, key, outId, fmt) {
    const el = document.getElementById(id);
    const out = document.getElementById(outId);
    el.addEventListener("input", () => {
      params[key] = (el.type === "range" ? parseFloat(el.value) : el.value);
      out.textContent = fmt ? fmt(el.value) : el.value;
      if (["depth","density","baseRadius","samples"].includes(key)) {
        regenerate();
      }
    });
  }
  bind("depth","depth","depthOut", v=>v);
  bind("density","density","densityOut", v=>parseFloat(v).toFixed(2));
  bind("baseRadius","baseRadius","radiusOut", v=>parseFloat(v).toFixed(2));
  bind("samples","samples","samplesOut", v=>v);
  bind("speed","speed","speedOut", v=>parseFloat(v).toFixed(2));

  document.getElementById("regenBtn").onclick = regenerate;
  let animPaused = false;
  document.getElementById("pauseBtn").onclick = () => {
    animPaused = !animPaused;
    document.getElementById("pauseBtn").textContent = animPaused ? "Reanudar anim" : "Pausar anim";
  };

  // helper: random with seed? Use Math.random for simplicity
  function rand() { return Math.random(); }
  function randRange(a,b){ return a + (b-a)*rand(); }

  // --- Tremas generation (list of circles)
  function buildTremas(depth, density, baseRadius) {
    // tremas: array of {cx,cy,r,level}
    const tremas = [];
    // For each level generate Poisson-like count ~ density * (2^level)
    for (let level=0; level<depth; level++){
      // scale radius per level (r decreases like scale^level)
      const scale = Math.pow(0.5, level); // geometric scale
      const levelRadius = baseRadius * scale;
      // number of tremas this level
      const count = Math.max(1, Math.floor(density * Math.pow(2, level+1) * 30));
      for (let i=0;i<count;i++){
        const cx = randRange(-1,1);
        const cy = randRange(-1,1);
        // jitter radius by +/-20%
        const r = levelRadius * (0.8 + 0.4*rand());
        tremas.push({cx,cy,r,level});
      }
    }
    return tremas;
  }

  // Generate sample points across [-1,1]^2 and reject those inside ANY trema circle
  function generatePointsFromTremas(tremas, samples) {
    const positions = [];
    const colors = [];
    const levels = [];
    let attempts = 0;
    const maxAttempts = samples * 10;
    while (positions.length / 2 < samples && attempts < maxAttempts) {
      attempts++;
      const x = randRange(-1,1);
      const y = randRange(-1,1);
      // if inside any trema -> reject
      let inside = false;
      for (let i=0;i<tremas.length;i++){
        const c = tremas[i];
        const dx = x - c.cx, dy = y - c.cy;
        if (dx*dx + dy*dy < c.r*c.r) { inside = true; break; }
      }
      if (!inside) {
        positions.push(x, y);
        // color mapped by distance to center (for variety)
        const cval = 0.4 + 0.6*rand();
        colors.push(0.2 + 0.6*rand(), 0.35 + 0.55*rand(), cval);
        // approximate level influence by smallest nearby trema level (if close)
        let nearLevel = 0;
        let minD = 1e9;
        for (let i=0;i<tremas.length;i++){
          const c = tremas[i];
          const d2 = (x-c.cx)*(x-c.cx) + (y-c.cy)*(y-c.cy);
          if (d2 < minD) { minD = d2; nearLevel = c.level; }
        }
        levels.push(nearLevel / Math.max(1, tremas.length>0 ? Math.max(...tremas.map(t=>t.level)) : 1));
      }
    }
    return {positions: new Float32Array(positions), colors: new Float32Array(colors), levels: new Float32Array(levels)};
  }

  // draw data
  let currentCount = 0;
  function uploadAndDraw(data) {
    // positions
    gl.bindBuffer(gl.ARRAY_BUFFER, posBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, data.positions, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(attribs.a_position);
    gl.vertexAttribPointer(attribs.a_position, 2, gl.FLOAT, false, 0, 0);

    // colors
    gl.bindBuffer(gl.ARRAY_BUFFER, colorBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, data.colors, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(attribs.a_color);
    gl.vertexAttribPointer(attribs.a_color, 3, gl.FLOAT, false, 0, 0);

    // levels
    gl.bindBuffer(gl.ARRAY_BUFFER, levelBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, data.levels, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(attribs.a_level);
    gl.vertexAttribPointer(attribs.a_level, 1, gl.FLOAT, false, 0, 0);

    currentCount = data.positions.length / 2;
  }

  // generate once
  function regenerate() {
    const tremas = buildTremas(params.depth, params.density, params.baseRadius);
    const data = generatePointsFromTremas(tremas, Math.floor(params.samples));
    uploadAndDraw(data);
    // cache tremas for debug if needed
    window._lastTremas = tremas;
  }

  // initial
  regenerate();

  // viewport / resize
  function resizeCanvas(){
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.floor(canvas.clientWidth * dpr);
    canvas.height = Math.floor(canvas.clientHeight * dpr);
    gl.viewport(0,0,canvas.width,canvas.height);
  }
  window.addEventListener("resize", resizeCanvas);
  resizeCanvas();

  // simple 2D MVP (scale+rotate+translate) as 3x3 matrix
  function buildMVP(angle, zoom, aspect) {
    const c = Math.cos(angle), s = Math.sin(angle);
    // rotation*scale
    const sx = zoom / aspect, sy = zoom;
    return new Float32Array([
      c*sx, -s*sy, 0,
      s*sx,  c*sy, 0,
      0,     0,    1
    ]);
  }

  // render loop
  let start = performance.now();
  function renderLoop(now){
    now = performance.now();
    const t = (now - start) / 1000.0;
    if (!animPaused) {
      // animate rotation slowly
      const angle = t * 0.25 * params.speed;
      const zoom = 1.0 + 0.05 * Math.sin(t * 0.4 * params.speed);
      const aspect = canvas.width / canvas.height;
      const mvp = buildMVP(angle, zoom, aspect);
      gl.useProgram(prog);
      gl.uniformMatrix3fv(uniforms.u_mvp, false, mvp);
      gl.uniform1f(uniforms.u_time, t);
      gl.uniform1f(uniforms.u_pointSize, params.pointSize * (window.devicePixelRatio || 1));
      gl.uniform1f(uniforms.u_speed, params.speed);

      gl.clearColor(0.01,0.02,0.03,1.0);
      gl.clear(gl.COLOR_BUFFER_BIT);

      // draw points
      gl.drawArrays(gl.POINTS, 0, currentCount);
    }
    requestAnimationFrame(renderLoop);
  }
  requestAnimationFrame(renderLoop);

  // save regenerate entry
  window.regenerateFractal = regenerate;
})();
