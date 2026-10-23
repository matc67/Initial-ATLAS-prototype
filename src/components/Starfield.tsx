import { useEffect, useRef } from 'react';

// A fixed, seeded star pattern behind the globe, so the sky looks the same on every visit.
export default function Starfield() {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current!;
    const draw = () => {
      const dpr = window.devicePixelRatio || 1, w = window.innerWidth, h = window.innerHeight;
      canvas.width = w * dpr; canvas.height = h * dpr;
      const ctx = canvas.getContext('2d')!;
      ctx.scale(dpr, dpr);
      let seed = 7;
      const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
      for (let i = 0, n = Math.round((w * h) / 2600); i < n; i++) {
        const r = rand() < 0.92 ? rand() * 0.8 + 0.2 : rand() * 1.1 + 0.8;
        ctx.globalAlpha = rand() * 0.6 + 0.15;
        ctx.fillStyle = rand() < 0.15 ? '#cfe0ff' : '#ffffff';
        ctx.beginPath(); ctx.arc(rand() * w, rand() * h, r, 0, Math.PI * 2); ctx.fill();
      }
    };
    draw();
    window.addEventListener('resize', draw);
    return () => window.removeEventListener('resize', draw);
  }, []);
  return <canvas className="starfield" ref={ref} aria-hidden="true" />;
}
