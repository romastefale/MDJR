// Frosted-glass surface: a div with backdrop blur/saturation. The specular/sheen/glow/strength/
// dispersion fields of an "optics" preset are carried along but not rendered.

function backdropFilter(optics) {
  const frost = Math.max(0, optics.frost ?? 6);
  const saturate = optics.saturate ?? 1.15;
  return [frost > 0 ? `blur(${frost}px)` : "", saturate !== 1 ? `saturate(${saturate})` : ""].filter(Boolean).join(" ") || "none";
}

export function Glass({ optics, style, children, ...rest }) {
  const filter = backdropFilter(optics);
  return (
    <div data-frost="" {...rest} style={{ position: "relative", backdropFilter: filter, WebkitBackdropFilter: filter, ...style }}>
      {children}
    </div>
  );
}

const FLAT = { specular: 0, sheen: 0, glow: 0 };
// GLASS_FLAT and GLASS_HEAVY are unused; kept as they were in the original bundle.
export const GLASS_FLAT = { ...FLAT };
export const GLASS_BAR = { ...FLAT, strength: 0, dispersion: 0, frost: 6, saturate: 1.15 };
export const GLASS_HEAVY = { ...FLAT, strength: 0, dispersion: 0, frost: 22, saturate: 1.4 };
