import { useEffect, useRef, useState } from 'preact/hooks';

interface Props {
  title: string;
  traitValue: number;
  onDone: (score: number) => void;
}

const SPEED = 0.78;

export function TimingGame({ title, traitValue, onDone }: Props) {
  const [pos, setPos] = useState(0);
  const [zone] = useState(() => 25 + Math.random() * 50);
  const [result, setResult] = useState<{ score: number; won: boolean } | null>(null);
  const dir = useRef(1);
  const raf = useRef(0);
  const width = Math.max(4, 8 + traitValue * 1.8);

  useEffect(() => {
    let last = performance.now();
    const tick = (now: number) => {
      const dt = Math.min(64, now - last);
      last = now;
      setPos((value) => {
        let next = value + dir.current * SPEED * dt;
        if (next > 100) {
          next = 100 - (next - 100);
          dir.current = -1;
        } else if (next < 0) {
          next = -next;
          dir.current = 1;
        }
        return next;
      });
      raf.current = requestAnimationFrame(tick);
    };
    raf.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf.current);
  }, []);

  useEffect(() => {
    if (result) cancelAnimationFrame(raf.current);
  }, [result]);

  const stop = () => {
    if (result) return;
    const distance = Math.abs(pos - zone);
    const score = Math.max(0, Math.min(1, 1 - distance / (width * 1.6)));
    setResult({ score, won: score >= 0.75 });
  };

  return (
    <div class="card cr-mini" data-testid="career-minigame">
      <div class="tiny muted">{title}</div>
      <div class="cr-mini-bar" onPointerDown={stop}>
        <div class="cr-mini-zone" style={{ left: `${zone - width / 2}%`, width: `${width}%` }} />
        <div class="cr-mini-marker" style={{ left: `${pos}%` }} />
      </div>
      {result ? (
        <>
          <div class="notice" data-testid="career-mini-result">
            {result.won ? 'Made the play' : 'Just missed'} · {Math.round(result.score * 100)}%
          </div>
          <button class="btn" onClick={() => onDone(result.score)}>
            Continue
          </button>
        </>
      ) : (
        <>
          <div class="notice">Tap the bar as the marker crosses the lit window.</div>
          <button class="btn" data-testid="career-mini-tap" onClick={stop}>
            Strike
          </button>
          <button class="btn btn-ghost btn-small" onClick={() => onDone(0)}>
            Simulate it
          </button>
        </>
      )}
    </div>
  );
}
