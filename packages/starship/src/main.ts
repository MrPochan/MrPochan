const canvas = document.getElementById('screen');
if (!(canvas instanceof HTMLCanvasElement)) {
  throw new Error('canvas#screen not found');
}
const ctx = canvas.getContext('2d');
if (!ctx) {
  throw new Error('2d context unavailable');
}

const view = canvas;
const context = ctx;

const resize = (): void => {
  const dpr = window.devicePixelRatio || 1;
  view.width = Math.floor(window.innerWidth * dpr);
  view.height = Math.floor(window.innerHeight * dpr);
  context.setTransform(dpr, 0, 0, dpr, 0, 0);
};

const draw = (): void => {
  const w = window.innerWidth;
  const h = window.innerHeight;
  context.fillStyle = '#05060d';
  context.fillRect(0, 0, w, h);
  context.fillStyle = '#e6e9f5';
  context.font = '16px system-ui, sans-serif';
  context.textAlign = 'center';
  context.fillText('Starship: каркас проекта', w / 2, h / 2);
};

window.addEventListener('resize', () => {
  resize();
  draw();
});

resize();
draw();
