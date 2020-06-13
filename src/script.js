/* eslint-env browser */
/* eslint-disable-next-line no-unused-vars  */
function sparkline(
  canvasId,
  data,
  color = 'rgba(0,0,0,0.5)',
  minimumLength = 0,
  minimumMax = 5
) {
  if (window.HTMLCanvasElement) {
    const c = document.getElementById(canvasId),
      ctx = c.getContext('2d'),
      height = c.height - 3,
      width = c.width,
      total = Math.max(minimumLength, data.length),
      max = Math.max(minimumMax, Math.max.apply(Math, data)),
      xstep = width / total,
      ystep = max / height;
    if (window.devicePixelRatio) {
      c.width = c.width * window.devicePixelRatio;
      c.height = c.height * window.devicePixelRatio;
      c.style.width = `${c.width / window.devicePixelRatio}px`;
      c.style.height = `${c.height / window.devicePixelRatio}px`;
      c.style.display = 'inline-block';
      ctx.scale(window.devicePixelRatio, window.devicePixelRatio);
    }
    let x = 0;
    let y = height - data[0] / ystep;
    ctx.clearRect(0, 0, width, height);
    ctx.beginPath();
    ctx.strokeStyle = color;
    ctx.moveTo(x, y);
    for (let i = 1; i < total; i = i + 1) {
      x = x + xstep;
      y = height - data[i] / ystep + 2;
      ctx.lineTo(x, y);
    }
    ctx.stroke();
  }
}
