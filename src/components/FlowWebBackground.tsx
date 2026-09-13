import { useEffect, useRef } from "react";

export function FlowWebBackground({ light }: { light: boolean }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const parent = canvas?.parentElement;
    const context = canvas?.getContext("2d");
    if (!canvas || !parent || !context) return;

    const draw = () => {
      const { width, height } = parent.getBoundingClientRect();
      const scale = window.devicePixelRatio || 1;
      canvas.width = Math.floor(width * scale);
      canvas.height = Math.floor(height * scale);
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
      context.setTransform(scale, 0, 0, scale, 0, 0);
      context.clearRect(0, 0, width, height);

      const centerX = width * 0.5;
      const centerY = height * 0.53;
      const radius = Math.hypot(width, height) * 0.62;
      const spokes = 14;
      const rings = 9;
      const points: Array<Array<{ x: number; y: number }>> = [];

      for (let ring = 1; ring <= rings; ring += 1) {
        points.push(Array.from({ length: spokes }, (_, spoke) => {
          const angle = (spoke / spokes) * Math.PI * 2;
          return {
            x: centerX + Math.cos(angle) * radius * (ring / rings),
            y: centerY + Math.sin(angle) * radius * (ring / rings),
          };
        }));
      }

      context.lineWidth = 1;
      context.strokeStyle = light ? "rgba(109,40,217,.075)" : "rgba(169,120,255,.085)";
      for (let spoke = 0; spoke < spokes; spoke += 1) {
        context.beginPath();
        context.moveTo(centerX, centerY);
        points.forEach((ring) => context.lineTo(ring[spoke].x, ring[spoke].y));
        context.stroke();
      }

      points.forEach((ring) => {
        context.beginPath();
        ring.forEach((point, index) => index === 0 ? context.moveTo(point.x, point.y) : context.lineTo(point.x, point.y));
        context.closePath();
        context.stroke();
      });

      points.forEach((ring, ringIndex) => ring.forEach((point, spoke) => {
        if ((ringIndex + spoke) % 2 !== 0) return;
        context.beginPath();
        context.arc(point.x, point.y, 1.5, 0, Math.PI * 2);
        context.fillStyle = (ringIndex + spoke) % 4 === 0
          ? (light ? "rgba(15,143,152,.22)" : "rgba(72,197,202,.24)")
          : (light ? "rgba(109,40,217,.2)" : "rgba(169,120,255,.22)");
        context.fill();
      }));
    };

    const observer = new ResizeObserver(draw);
    observer.observe(parent);
    draw();
    return () => observer.disconnect();
  }, [light]);

  return <canvas className="flow-web-background" ref={canvasRef} aria-hidden="true" />;
}
