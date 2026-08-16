export interface CropRect {
  originX: number;
  originY: number;
  width: number;
  height: number;
}

/**
 * Maps the crop-UI viewport (square of `viewport` px, image cover-fitted,
 * zoomed by `zoom`, panned by `panX/panY` px) to a source-pixel crop rect.
 */
export function cropRectFor(
  imgW: number,
  imgH: number,
  viewport: number,
  zoom: number,
  panX: number,
  panY: number,
): CropRect {
  const base = viewport / Math.min(imgW, imgH);
  const S = base * zoom;
  const topLeftX = (viewport - imgW * S) / 2 + panX;
  const topLeftY = (viewport - imgH * S) / 2 + panY;
  const size = Math.min(viewport / S, imgW, imgH);
  const clamp = (n: number, hi: number) => Math.min(Math.max(0, n), Math.max(0, hi));
  return {
    originX: Math.round(clamp(-topLeftX / S, imgW - size)),
    originY: Math.round(clamp(-topLeftY / S, imgH - size)),
    width: Math.round(size),
    height: Math.round(size),
  };
}
