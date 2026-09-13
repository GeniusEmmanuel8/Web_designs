import { useEffect, useRef } from "react";

export function WebBackground({ light }: { light: boolean }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const context = canvas.getContext("2d");
    if (!context) return;

    let width = window.innerWidth;
    let height = window.innerHeight;
    let frame = 0;
    const pointer: { x: number | null; y: number | null } = { x: null, y: null };

    const resize = () => {
      const scale = window.devicePixelRatio || 1;
      width = window.innerWidth;
      height = window.innerHeight;
      canvas.width = Math.floor(width * scale);
      canvas.height = Math.floor(height * scale);
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
      context.setTransform(scale, 0, 0, scale, 0, 0);
    };

    const onMove = (event: PointerEvent) => {
      pointer.x = event.clientX;
      pointer.y = event.clientY;
    };

    const draw = () => {
      context.clearRect(0, 0, width, height);
      const cx = width >= 1100 ? width * 0.49 : width * 0.58;
      const cy = height * 0.5;
      const radius = Math.max(
        Math.hypot(cx, cy),
        Math.hypot(width - cx, cy),
        Math.hypot(cx, height - cy),
        Math.hypot(width - cx, height - cy),
      ) * 1.04;
      const spokes = 14;
      const rings = Math.min(12, Math.max(7, Math.ceil(radius / 88)));
      const time = performance.now() * 0.00065;

      const webPoints: Array<Array<{ x: number; y: number }>> = [];
      for (let ring = 1; ring <= rings; ring += 1) {
        const ringPoints: Array<{ x: number; y: number }> = [];
        for (let spoke = 0; spoke < spokes; spoke += 1) {
          const angle = (spoke / spokes) * Math.PI * 2;
          const wave = Math.sin(time + ring * 0.8 + spoke * 0.2) * 2.5;
          let x = cx + Math.cos(angle) * ((radius * ring) / rings + wave);
          let y = cy + Math.sin(angle) * ((radius * ring) / rings + wave);
          if (pointer.x !== null && pointer.y !== null) {
            const dx = pointer.x - x;
            const dy = pointer.y - y;
            const distance = Math.hypot(dx, dy);
            if (distance > 0 && distance < 170) {
              const pull = ((170 - distance) / 170) * 22;
              x += (dx / distance) * pull;
              y += (dy / distance) * pull;
            }
          }
          ringPoints.push({ x, y });
        }
        webPoints.push(ringPoints);
      }

      for (let spoke = 0; spoke < spokes; spoke += 1) {
        context.beginPath();
        context.moveTo(cx, cy);
        webPoints.forEach((ringPoints) => context.lineTo(ringPoints[spoke].x, ringPoints[spoke].y));
        context.strokeStyle = light ? "rgba(109,40,217,.16)" : "rgba(196,181,253,.12)";
        context.stroke();
      }

      webPoints.forEach((ringPoints) => {
        context.beginPath();
        ringPoints.forEach((point, index) => {
          if (index === 0) context.moveTo(point.x, point.y);
          else context.lineTo(point.x, point.y);
        });
        context.closePath();
        context.strokeStyle = light ? "rgba(124,58,237,.21)" : "rgba(167,139,250,.16)";
        context.stroke();
      });

      webPoints.forEach((ringPoints, ringIndex) => {
        ringPoints.forEach(({ x, y }, spoke) => {
          const purpleNode = (ringIndex + spoke + 1) % 3 === 0;
          context.fillStyle = purpleNode
            ? (light ? "rgba(109,40,217,.66)" : "rgba(169,120,255,.62)")
            : (light ? "rgba(13,148,160,.6)" : "rgba(72,197,202,.56)");
          context.beginPath();
          context.arc(x, y, ringIndex < 2 ? 3.25 : 2.35, 0, Math.PI * 2);
          context.fill();
        });
      });

      context.beginPath();
      context.arc(cx, cy, 17, 0, Math.PI * 2);
      context.fillStyle = light ? "rgba(109,40,217,.13)" : "rgba(169,120,255,.18)";
      context.fill();
      context.beginPath();
      context.arc(cx, cy, 7, 0, Math.PI * 2);
      context.fillStyle = light ? "rgba(109,40,217,.86)" : "rgba(169,120,255,.9)";
      context.fill();
      frame = requestAnimationFrame(draw);
    };

    resize();
    draw();
    window.addEventListener("resize", resize);
    window.addEventListener("pointermove", onMove);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("resize", resize);
      window.removeEventListener("pointermove", onMove);
    };
  }, [light]);

  return <canvas className="web-background" ref={canvasRef} aria-hidden="true" />;
}
