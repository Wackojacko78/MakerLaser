import { useEffect, useRef, useState } from 'react';
import {
  BUTTON_ZOOM_STEP,
  MIN_ZOOM,
  actualSizeZoom,
  clampView,
  fitView,
  isMagnified,
  panBy,
  pictureAt,
  screenPercent,
  viewBoxAttr,
  viewBoxOf,
  wheelFactor,
  zoomAt,
  type PreviewView,
} from '@/lib/previewView';

interface Props {
  /** The size of the picture that was traced, in pixels. The outlines are in the same pixels. */
  width: number;
  height: number;
  /** What is shown, and the way to change it. The owner keeps it, so it survives while the preview is not on the screen. */
  view: PreviewView;
  onViewChange: (view: PreviewView) => void;
  /** The picture, at that same size. */
  imageUrl: string;
  /** SVG path data of the outlines. */
  pathData: string;
  showPicture: boolean;
  /** The outlines are out of date (a setting has just changed): drawn faintly until the new ones are ready. */
  stale: boolean;
}

/**
 * The picture with its outlines over it, which you can look at closely: the mouse wheel zooms towards the
 * pointer, dragging moves the picture, double-click shows all of it again, and the buttons below do the same
 * (1:1 shows one picture pixel for each screen pixel). When each picture pixel is two or more screen pixels
 * wide the picture is drawn as sharp squares, so you can see exactly which pixels were traced.
 *
 * The view is controlled: the owner passes it in and is told about every change, so the zoom can be kept for
 * each picture. The maths is in lib/previewView.ts.
 */
export function ZoomPreview({ width, height, view: given, onViewChange, imageUrl, pathData, showPicture, stale }: Props) {
  const [box, setBox] = useState({ w: 0, h: 0 });
  const [dragging, setDragging] = useState(false);
  const svgRef = useRef<SVGSVGElement>(null);
  const drag = useRef<{ x: number; y: number; view: PreviewView } | null>(null);
  const view = clampView(given, width, height);
  const vb = viewBoxOf(view, width, height);
  // The newest view, written as soon as it changes (not only after drawing), so several wheel clicks in one
  // frame add up instead of each starting from the same old view.
  const latest = useRef<PreviewView>(view);
  const setView = (next: PreviewView) => {
    latest.current = next;
    onViewChange(next);
  };
  useEffect(() => {
    latest.current = view;
  });
  // The wheel listener is installed once, so it reaches the newest callback through this.
  const notify = useRef(onViewChange);
  useEffect(() => {
    notify.current = onViewChange;
  });

  // The size of the drawing area on the screen, for 1:1 and the zoom shown.
  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    const measure = () => setBox({ w: svg.clientWidth, h: svg.clientHeight });
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(measure);
    observer.observe(svg);
    return () => observer.disconnect();
  }, []);

  // The wheel has to be a real listener: React's own wheel handlers cannot stop the panel behind from scrolling.
  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      // Worked out from the newest view, not from what is drawn: a quick spin of the wheel sends several
      // clicks before the screen is redrawn.
      const v = clampView(latest.current, width, height);
      const at = pictureAt(v, width, height, svg.getBoundingClientRect(), e.clientX, e.clientY);
      if (!at) return;
      const next = zoomAt(v, wheelFactor(e.deltaY, e.deltaMode), at.x, at.y, width, height);
      latest.current = next;
      notify.current(next);
    };
    svg.addEventListener('wheel', onWheel, { passive: false });
    return () => svg.removeEventListener('wheel', onWheel);
  }, [width, height]);

  const step = (factor: number) => setView(zoomAt(view, factor, view.cx, view.cy, width, height));
  const fit = () => setView(fitView(width, height));
  const actualSize = () => setView(zoomAt(view, actualSizeZoom(width, height, box.w, box.h) / view.zoom, view.cx, view.cy, width, height));

  const zoomedIn = view.zoom > MIN_ZOOM + 1e-9;
  const sharp = isMagnified(view, width, height, box.w, box.h);

  return (
    <div style={{ display: 'grid', gap: 4, minWidth: 0 }}>
      <svg
        ref={svgRef}
        role="img"
        aria-label="Preview of the outlines over the picture. Scroll to zoom, drag to move, double-click to show all of it."
        viewBox={viewBoxAttr(vb)}
        preserveAspectRatio="xMidYMid meet"
        style={{
          display: 'block',
          width: '100%',
          maxHeight: 320,
          aspectRatio: `${width} / ${height}`,
          background: '#070d12',
          borderRadius: 6,
          opacity: stale ? 0.6 : 1,
          cursor: dragging ? 'grabbing' : zoomedIn ? 'grab' : 'default',
          touchAction: 'none',
          userSelect: 'none',
        }}
        onPointerDown={(e) => {
          if (e.button !== 0 && e.button !== 1) return;
          e.preventDefault();
          e.currentTarget.setPointerCapture(e.pointerId);
          drag.current = { x: e.clientX, y: e.clientY, view };
          setDragging(true);
        }}
        onPointerMove={(e) => {
          const d = drag.current;
          const m = svgRef.current?.getScreenCTM();
          if (!d || !m || !(m.a > 0)) return;
          // m.a is how many screen pixels one picture pixel is right now.
          setView(panBy(d.view, -(e.clientX - d.x) / m.a, -(e.clientY - d.y) / m.a, width, height));
        }}
        onPointerUp={() => {
          drag.current = null;
          setDragging(false);
        }}
        onPointerCancel={() => {
          drag.current = null;
          setDragging(false);
        }}
        onDoubleClick={fit}
      >
        {showPicture && (
          <image
            href={imageUrl}
            x={0}
            y={0}
            width={width}
            height={height}
            preserveAspectRatio="none"
            opacity={0.5}
            style={{ imageRendering: sharp ? 'pixelated' : 'auto' }}
          />
        )}
        <path d={pathData} fill="rgba(54, 216, 237, 0.2)" fillRule="evenodd" stroke="#36d8ed" strokeWidth={1.3} vectorEffect="non-scaling-stroke" strokeLinejoin="round" />
      </svg>
      <div style={{ display: 'flex', gap: 4, alignItems: 'center', flexWrap: 'wrap' }}>
        <button className="mini" aria-label="Zoom out" title="Zoom out" disabled={!zoomedIn} onClick={() => step(1 / BUTTON_ZOOM_STEP)}>
          {'\u2212'}
        </button>
        <button className="mini" aria-label="Zoom in" title="Zoom in" onClick={() => step(BUTTON_ZOOM_STEP)}>
          +
        </button>
        <button className="mini" title="Show all of the picture" disabled={!zoomedIn} onClick={fit}>
          Fit
        </button>
        <button className="mini" title="Show one picture pixel for each screen pixel" onClick={actualSize}>
          1:1
        </button>
        <span style={{ marginLeft: 'auto', fontSize: 12, color: 'var(--muted)' }} title="100% is one picture pixel for each screen pixel">
          {screenPercent(view, width, height, box.w, box.h)}%
        </span>
      </div>
    </div>
  );
}
