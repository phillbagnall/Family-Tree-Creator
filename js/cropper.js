// Photo cropping: move and zoom a picture inside a circle.
// Drag (mouse or finger) to move, pinch / mouse wheel / slider to zoom.

import { h, modal } from './ui.js';

const OUT = 480; // size of the saved square picture, in pixels

function loadBitmap(blob) {
  return createImageBitmap(blob).catch(() => new Promise((res, rej) => {
    const img = new Image();
    img.onload = () => res(img);
    img.onerror = () => rej(new Error("Couldn't read that picture"));
    img.src = URL.createObjectURL(blob);
  }));
}

// Opens the crop dialog. `crop` is a previous choice ({cx, cy, zoom}) to start from.
// Resolves to {blob, crop} or null if cancelled.
export async function cropPhoto(blob, crop = null) {
  const img = await loadBitmap(blob);
  const W = img.width, H = img.height;
  const S = Math.min(300, window.innerWidth - 90);
  const dpr = Math.min(3, window.devicePixelRatio || 1);
  const canvas = h('canvas', { width: Math.round(S * dpr), height: Math.round(S * dpr), class: 'crop-canvas', style: { width: `${S}px`, height: `${S}px` } });
  const ctx = canvas.getContext('2d');

  const minK = S / Math.min(W, H); // smallest zoom that still fills the circle
  const maxZoom = 6;
  let zoom = crop ? Math.max(1, Math.min(maxZoom, crop.zoom)) : 1;
  let cx = crop ? crop.cx : 0.5; // centre of the view, as a fraction of the picture
  let cy = crop ? crop.cy : 0.42; // faces tend to sit a little above centre

  const clamp = () => {
    const k = minK * zoom;
    const halfW = S / 2 / k / W, halfH = S / 2 / k / H;
    cx = Math.min(1 - halfW, Math.max(halfW, cx));
    cy = Math.min(1 - halfH, Math.max(halfH, cy));
  };

  const draw = () => {
    clamp();
    const k = minK * zoom * dpr;
    const size = S * dpr;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, size, size);
    ctx.drawImage(img, size / 2 - cx * W * k, size / 2 - cy * H * k, W * k, H * k);
    // Darken outside the circle.
    ctx.fillStyle = 'rgba(0,0,0,0.6)';
    ctx.beginPath();
    ctx.rect(0, 0, size, size);
    ctx.arc(size / 2, size / 2, size / 2 - 2 * dpr, 0, Math.PI * 2, true);
    ctx.fill('evenodd');
    ctx.strokeStyle = 'rgba(255,255,255,0.9)';
    ctx.lineWidth = 2 * dpr;
    ctx.beginPath();
    ctx.arc(size / 2, size / 2, size / 2 - 2 * dpr, 0, Math.PI * 2);
    ctx.stroke();
  };

  const slider = h('input', {
    type: 'range', min: 1, max: maxZoom, step: 0.01, value: zoom, 'aria-label': 'Zoom',
    oninput: (e) => { zoom = Number(e.target.value); draw(); },
  });
  const setZoom = (z) => { zoom = Math.max(1, Math.min(maxZoom, z)); slider.value = zoom; draw(); };

  // Dragging and pinching
  const pts = new Map();
  let last = null;
  let pinch = null;
  canvas.addEventListener('pointerdown', (e) => {
    canvas.setPointerCapture(e.pointerId);
    pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pts.size === 2) {
      const [a, b] = [...pts.values()];
      pinch = { d: Math.hypot(a.x - b.x, a.y - b.y), z: zoom };
    }
    last = { x: e.clientX, y: e.clientY };
  });
  canvas.addEventListener('pointermove', (e) => {
    if (!pts.has(e.pointerId)) return;
    pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pts.size >= 2 && pinch) {
      const [a, b] = [...pts.values()];
      setZoom(pinch.z * (Math.hypot(a.x - b.x, a.y - b.y) / pinch.d));
      return;
    }
    const k = minK * zoom;
    cx -= (e.clientX - last.x) / k / W;
    cy -= (e.clientY - last.y) / k / H;
    last = { x: e.clientX, y: e.clientY };
    draw();
  });
  const up = (e) => {
    pts.delete(e.pointerId);
    if (pts.size < 2) pinch = null;
    const rest = [...pts.values()][0];
    if (rest) last = { ...rest };
  };
  canvas.addEventListener('pointerup', up);
  canvas.addEventListener('pointercancel', up);
  canvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    setZoom(zoom * Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.002)));
  }, { passive: false });

  draw();
  const body = h('div', { class: 'crop' },
    canvas,
    h('div', { class: 'crop-zoom' }, h('span', { 'aria-hidden': 'true' }, '−'), slider, h('span', { 'aria-hidden': 'true' }, '+')),
    h('p', { class: 'hint' }, 'Drag to move the picture. Pinch, scroll or use the slider to zoom.'));

  const r = await modal({
    title: 'Fit the picture',
    body,
    buttons: [{ label: 'Cancel', value: '' }, { label: 'Use this', value: 'ok', primary: true }],
  });
  if (!r) return null;

  clamp();
  const out = document.createElement('canvas');
  out.width = out.height = OUT;
  const octx = out.getContext('2d');
  const k = (minK * zoom * OUT) / S;
  octx.fillStyle = '#fff';
  octx.fillRect(0, 0, OUT, OUT);
  octx.imageSmoothingQuality = 'high';
  octx.drawImage(img, OUT / 2 - cx * W * k, OUT / 2 - cy * H * k, W * k, H * k);
  const outBlob = await new Promise((res) => out.toBlob(res, 'image/jpeg', 0.88));
  return { blob: outBlob, crop: { cx, cy, zoom } };
}
