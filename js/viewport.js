// Pan and zoom for the tree canvas: mouse, trackpad and touch (pinch).
// Zooming changes an SVG transform, so the browser redraws vector shapes at
// the new size rather than stretching pixels: always sharp.

export class Viewport {
  constructor(svg, world, handlers) {
    this.svg = svg;
    this.world = world;
    this.h = handlers; // {tap(id|null), dragStart(id), drag(id, dx, dy), dragEnd(id), changed()}
    this.t = { x: 0, y: 0, k: 1 };
    this.pointers = new Map();
    this.gesture = null;
    this.minK = 0.08;
    this.maxK = 6;

    svg.addEventListener('pointerdown', (e) => this.down(e));
    svg.addEventListener('pointermove', (e) => this.move(e));
    svg.addEventListener('pointerup', (e) => this.up(e));
    svg.addEventListener('pointercancel', (e) => this.up(e, true));
    svg.addEventListener('wheel', (e) => this.wheel(e), { passive: false });
    // Safari trackpad pinch
    svg.addEventListener('gesturestart', (e) => { e.preventDefault(); this.gk = this.t.k; });
    svg.addEventListener('gesturechange', (e) => {
      e.preventDefault();
      const r = svg.getBoundingClientRect();
      this.zoomTo(this.gk * e.scale, e.clientX - r.left, e.clientY - r.top);
    });
  }

  apply() {
    const { x, y, k } = this.t;
    this.world.setAttribute('transform', `translate(${x},${y}) scale(${k})`);
    this.h.changed && this.h.changed(this.t);
  }

  local(e) {
    const r = this.svg.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  toWorld(sx, sy) {
    return { x: (sx - this.t.x) / this.t.k, y: (sy - this.t.y) / this.t.k };
  }

  zoomTo(k, sx, sy) {
    k = Math.max(this.minK, Math.min(this.maxK, k));
    const w = this.toWorld(sx, sy);
    this.t.k = k;
    this.t.x = sx - w.x * k;
    this.t.y = sy - w.y * k;
    this.apply();
  }

  zoomBy(f) {
    const r = this.svg.getBoundingClientRect();
    this.animateTo(null, null, this.t.k * f, r.width / 2, r.height / 2);
  }

  fit(b, pad = 40) {
    const r = this.svg.getBoundingClientRect();
    if (!r.width || !r.height) return;
    const k = Math.max(this.minK, Math.min(1.2, (r.width - pad * 2) / b.w, (r.height - pad * 2) / b.h));
    this.t.k = k;
    this.t.x = r.width / 2 - (b.x + b.w / 2) * k;
    this.t.y = r.height / 2 - (b.y + b.h / 2) * k;
    this.apply();
  }

  // Like fit(), but never smaller than minK: big trees open at a readable size,
  // showing the top (oldest generation) in the middle.
  fitReadable(b, minK = 0.55, pad = 40) {
    const r = this.svg.getBoundingClientRect();
    if (!r.width || !r.height) return;
    const k = Math.min(1.2, (r.width - pad * 2) / b.w, (r.height - pad * 2) / b.h);
    if (k >= minK) return this.fit(b, pad);
    this.t.k = minK;
    this.t.x = r.width / 2 - (b.x + b.w / 2) * minK;
    this.t.y = pad + 30 - b.y * minK;
    if (b.h * minK < r.height - pad * 2) this.t.y = r.height / 2 - (b.y + b.h / 2) * minK;
    this.apply();
  }

  // Smoothly centre on a world point (optionally zooming).
  animateTo(wx, wy, k = this.t.k, sx, sy) {
    const r = this.svg.getBoundingClientRect();
    const from = { ...this.t };
    k = Math.max(this.minK, Math.min(this.maxK, k));
    let to;
    if (wx == null) {
      const w = this.toWorld(sx, sy);
      to = { k, x: sx - w.x * k, y: sy - w.y * k };
    } else {
      to = { k, x: r.width / 2 - wx * k, y: r.height / 2 - wy * k };
    }
    const t0 = performance.now();
    cancelAnimationFrame(this.anim);
    const tick = (now) => {
      const p = Math.min(1, (now - t0) / 260);
      const e = 1 - Math.pow(1 - p, 3);
      this.t = { x: from.x + (to.x - from.x) * e, y: from.y + (to.y - from.y) * e, k: from.k + (to.k - from.k) * e };
      this.apply();
      if (p < 1) this.anim = requestAnimationFrame(tick);
    };
    this.anim = requestAnimationFrame(tick);
  }

  wheel(e) {
    e.preventDefault();
    const p = this.local(e);
    let dy = e.deltaY, dx = e.deltaX;
    if (e.deltaMode === 1) { dy *= 16; dx *= 16; }
    // Mouse wheels (and trackpad pinch, which sends ctrlKey) zoom; two-finger trackpad scroll pans.
    const mouseWheel = e.deltaMode === 1 || (dx === 0 && Math.abs(dy) >= 40 && Number.isInteger(dy));
    if (e.ctrlKey || mouseWheel) {
      const f = Math.exp(-dy * (e.ctrlKey ? 0.01 : 0.0022));
      this.zoomTo(this.t.k * f, p.x, p.y);
    } else {
      this.t.x -= dx;
      this.t.y -= dy;
      this.apply();
    }
  }

  down(e) {
    if (e.button && e.button !== 0) return;
    this.svg.setPointerCapture(e.pointerId);
    this.pointers.set(e.pointerId, this.local(e));
    if (this.pointers.size === 1) {
      const card = e.target.closest && e.target.closest('[data-id]');
      const p = this.local(e);
      this.gesture = { type: 'press', id: card ? card.dataset.id : null, start: p, last: p, t: performance.now(), moved: false };
    } else if (this.pointers.size === 2) {
      if (this.gesture && this.gesture.type === 'drag') this.h.dragEnd(this.gesture.id);
      const [a, b] = [...this.pointers.values()];
      this.gesture = { type: 'pinch', dist: Math.hypot(a.x - b.x, a.y - b.y), k: this.t.k, mid: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 } };
    }
  }

  move(e) {
    if (!this.pointers.has(e.pointerId)) return;
    const p = this.local(e);
    this.pointers.set(e.pointerId, p);
    const g = this.gesture;
    if (!g) return;
    if (g.type === 'pinch' && this.pointers.size >= 2) {
      const [a, b] = [...this.pointers.values()];
      const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      const dist = Math.hypot(a.x - b.x, a.y - b.y);
      this.t.x += mid.x - g.mid.x;
      this.t.y += mid.y - g.mid.y;
      g.mid = mid;
      this.zoomTo(g.k * (dist / g.dist), mid.x, mid.y);
      return;
    }
    if (g.type === 'press') {
      const far = Math.hypot(p.x - g.start.x, p.y - g.start.y) > (e.pointerType === 'mouse' ? 4 : 9);
      if (!far) return;
      g.moved = true;
      if (g.id) {
        g.type = 'drag';
        this.h.dragStart(g.id);
      } else g.type = 'pan';
    }
    if (g.type === 'pan') {
      this.t.x += p.x - g.last.x;
      this.t.y += p.y - g.last.y;
      this.apply();
    } else if (g.type === 'drag') {
      this.h.drag(g.id, (p.x - g.start.x) / this.t.k, (p.y - g.start.y) / this.t.k);
    }
    g.last = p;
  }

  up(e, cancelled) {
    if (!this.pointers.has(e.pointerId)) return;
    this.pointers.delete(e.pointerId);
    const g = this.gesture;
    if (this.pointers.size === 0) {
      if (g && g.type === 'press' && !cancelled) this.h.tap(g.id);
      if (g && g.type === 'drag') this.h.dragEnd(g.id);
      this.gesture = null;
    } else if (g && g.type === 'pinch') {
      // One finger left: carry on panning from where it is.
      const [p] = [...this.pointers.values()];
      this.gesture = { type: 'pan', last: p, start: p, moved: true };
    }
  }
}
