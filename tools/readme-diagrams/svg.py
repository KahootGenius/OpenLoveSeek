"""SVG helpers for the README diagrams (Python stdlib only).

Each figure is drawn once with placeholder colors and rendered twice, light
and dark, so the README can switch between them with <picture> and
prefers-color-scheme. Ink is currentColor (set by the root <svg color=...>);
the paper color and the three accents are placeholders swapped at render:

    BLUE = the chat model    TEAL = the cheap utility model
    VERM = the thing under discussion (the live probe, v3.0 additions)

A rough text-width estimate warns at build time when a label is likely to
overflow its box or the canvas.
"""
from html import escape

INK = "currentColor"
PAPER = "@PAPER@"
BLUE = "@BLUE@"
TEAL = "@TEAL@"
VERM = "@VERM@"

THEMES = {
    "light": {"ink": "#1f2328", PAPER: "#ffffff", BLUE: "#2f6db0", TEAL: "#11806a", VERM: "#c9481b"},
    "dark": {"ink": "#e6edf3", PAPER: "#0d1117", BLUE: "#6ea8e0", TEAL: "#3fb598", VERM: "#f0784a"},
}
SANS = ("-apple-system, BlinkMacSystemFont, 'Segoe UI', 'Noto Sans', Helvetica, Arial, "
        "'PingFang SC', 'Hiragino Sans GB', 'Microsoft YaHei', 'Noto Sans CJK SC', sans-serif")
MONO = "ui-monospace, SFMono-Regular, 'SF Mono', Menlo, Consolas, 'Liberation Mono', monospace"

WARNINGS = []


def tw(s, size=12, mono=False):
    """Rough rendered width of a string, in px."""
    if mono:
        return sum(1.0 if ord(c) > 0x2E7F else 0.6 for c in s) * size
    w = 0.0
    for ch in s:
        if ord(ch) > 0x2E7F:
            w += 1.0
        elif ch in "iljtfrI.,:;'|!()[]":
            w += 0.3
        elif ch in "→←⇒·≥≤≈±–—…“”":
            w += 0.8
        elif ch.isupper() or ch in "mw":
            w += 0.68
        elif ch == " ":
            w += 0.28
        else:
            w += 0.55
    return w * size


def wrap_tokens(tokens, maxw, size, mono=False, sep=" · "):
    """Greedy wrap of a token list joined by `sep`."""
    lines, cur = [], ""
    for t in tokens:
        cand = t if not cur else cur + sep + t
        if cur and tw(cand, size, mono) > maxw:
            lines.append(cur)
            cur = t
        else:
            cur = cand
    if cur:
        lines.append(cur)
    return lines


class Canvas:
    _marker_keys = {INK: "k", BLUE: "b", TEAL: "t", VERM: "v"}

    def __init__(self, name, w, h, title):
        self.name, self.w, self.h, self.title = name, w, h, title
        self.parts = []

    def warn(self, msg):
        WARNINGS.append(f"[{self.name}] {msg}")

    def raw(self, s):
        self.parts.append(s)

    # ---- text ---------------------------------------------------------------
    def text(self, x, y, s, size=12, anchor="middle", weight=None, color=None,
             opacity=None, mono=False, halo=False, italic=False):
        a = [f'x="{x:g}" y="{y:g}" font-size="{size:g}" text-anchor="{anchor}"',
             f'fill="{color or INK}"']
        if weight:
            a.append(f'font-weight="{weight}"')
        if opacity is not None:
            a.append(f'opacity="{opacity:g}"')
        if mono:
            a.append(f'font-family="{MONO}"')
        if italic:
            a.append('font-style="italic"')
        if halo:
            a.append(f'paint-order="stroke" stroke="{PAPER}" stroke-width="5" stroke-linejoin="round"')
        est = tw(s, size, mono)
        left = x - est if anchor == "end" else x - est / 2 if anchor == "middle" else x
        if left < 2 or left + est > self.w - 2:
            self.warn(f"text may leave the canvas ({left:.0f}..{left + est:.0f} of {self.w}): {s[:60]!r}")
        self.parts.append(f"<text {' '.join(a)}>{escape(s)}</text>")

    def eyebrow(self, x, y, s, size=10.5, anchor="start"):
        self.text(x, y, s, size, anchor=anchor, mono=True, opacity=0.65, weight=600)

    # ---- shapes ---------------------------------------------------------------
    def rect(self, x, y, w, h, r=6, stroke=INK, sw=1.2, fill="none", fill_op=None, dash=None, opacity=None):
        a = (f'x="{x:g}" y="{y:g}" width="{w:g}" height="{h:g}" rx="{r:g}" '
             f'stroke="{stroke}" stroke-width="{sw:g}" fill="{fill}"')
        if fill_op is not None:
            a += f' fill-opacity="{fill_op:g}"'
        if dash:
            a += f' stroke-dasharray="{dash}"'
        if opacity is not None:
            a += f' opacity="{opacity:g}"'
        self.parts.append(f"<rect {a}/>")

    def box(self, x, y, w, h, lines, style="plain", size=12, sub=None, color=None, lh=None, bold=True):
        """Rounded box; first line is the title (bold), the rest use `sub` size.
        Styles: plain | tint | accent | dashed | ink | faint."""
        color = color or INK
        if style == "plain":
            self.rect(x, y, w, h)
        elif style == "tint":
            self.rect(x, y, w, h, fill=INK, fill_op=0.06)
        elif style == "accent":
            self.rect(x, y, w, h, stroke=color, sw=2, fill=color, fill_op=0.09)
        elif style == "dashed":
            self.rect(x, y, w, h, dash="5 4")
        elif style == "ink":
            self.rect(x, y, w, h, stroke=INK, fill=INK)
        elif style == "faint":
            self.rect(x, y, w, h, sw=0.8, opacity=0.4)
        if isinstance(lines, str):
            lines = [lines]
        sub = sub or max(size - 1.5, 10)
        sizes = [size] + [sub] * (len(lines) - 1)
        lh = lh or size * 1.38
        y0 = y + h / 2 - lh * (len(lines) - 1) / 2 + size * 0.36
        for i, (s, sz) in enumerate(zip(lines, sizes)):
            if tw(s, sz) > w - 10:
                self.warn(f"box text wider than box ({tw(s, sz):.0f} > {w - 10}): {s[:60]!r}")
            self.text(x + w / 2, y0 + i * lh, s, sz,
                      weight=(600 if i == 0 and bold else None),
                      color=(PAPER if style == "ink" else None),
                      opacity=(0.45 if style == "faint" else None))

    def diamond(self, cx, cy, w, h, lines, size=11):
        pts = f"{cx:g},{cy - h / 2:g} {cx + w / 2:g},{cy:g} {cx:g},{cy + h / 2:g} {cx - w / 2:g},{cy:g}"
        self.parts.append(f'<polygon points="{pts}" fill="{INK}" fill-opacity="0.045" stroke="{INK}" stroke-width="1.2"/>')
        lh = size * 1.3
        y0 = cy - lh * (len(lines) - 1) / 2 + size * 0.36
        for i, s in enumerate(lines):
            if tw(s, size) > w * 0.62:
                self.warn(f"diamond text tight ({tw(s, size):.0f} > {w * 0.62:.0f}): {s!r}")
            self.text(cx, y0 + i * lh, s, size)

    def pill(self, x, y, label, color=INK, size=9.5, filled=True):
        w, h = tw(label, size, mono=True) + 14, size + 8
        if filled:
            self.rect(x, y, w, h, r=h / 2, stroke=color, fill=color)
            self.text(x + w / 2, y + h / 2 + size * 0.36, label, size, color=PAPER, mono=True, weight=600)
        else:
            self.rect(x, y, w, h, r=h / 2, stroke=color, sw=1, fill=color, fill_op=0.1)
            self.text(x + w / 2, y + h / 2 + size * 0.36, label, size, color=color, mono=True, weight=600)
        return w

    def dot(self, x, y, r=3.5, color=INK):
        self.parts.append(f'<circle cx="{x:g}" cy="{y:g}" r="{r:g}" fill="{color}" stroke="{color}" stroke-width="1.5"/>')

    def hline(self, x1, x2, y, op=0.25, dash=None, sw=1):
        a = f'x1="{x1:g}" y1="{y:g}" x2="{x2:g}" y2="{y:g}" stroke="{INK}" stroke-width="{sw:g}" opacity="{op:g}"'
        if dash:
            a += f' stroke-dasharray="{dash}"'
        self.parts.append(f"<line {a}/>")

    def vline(self, x, y1, y2, op=0.25, dash=None, color=INK, sw=1):
        a = f'x1="{x:g}" y1="{y1:g}" x2="{x:g}" y2="{y2:g}" stroke="{color}" stroke-width="{sw:g}" opacity="{op:g}"'
        if dash:
            a += f' stroke-dasharray="{dash}"'
        self.parts.append(f"<line {a}/>")

    # ---- connectors -----------------------------------------------------------
    def line(self, pts, color=INK, sw=1.2, dash=None, arrow=True):
        d = " ".join(f"{x:g},{y:g}" for x, y in pts)
        a = f'points="{d}" fill="none" stroke="{color}" stroke-width="{sw:g}" stroke-linejoin="round"'
        if dash:
            a += f' stroke-dasharray="{dash}"'
        if arrow:
            a += f' marker-end="url(#{self.name}-arr-{self._marker_keys.get(color, "k")})"'
        self.parts.append(f"<polyline {a}/>")

    def curve(self, d, color=INK, sw=1.2, dash=None, arrow=True):
        a = f'd="{d}" fill="none" stroke="{color}" stroke-width="{sw:g}"'
        if dash:
            a += f' stroke-dasharray="{dash}"'
        if arrow:
            a += f' marker-end="url(#{self.name}-arr-{self._marker_keys.get(color, "k")})"'
        self.parts.append(f"<path {a}/>")

    def arrow(self, pts, label=None, color=INK, sw=1.2, dash=None, size=11, lx=None, ly=None,
              anchor="middle", weight=None):
        self.line(pts, color, sw, dash, True)
        if label:
            if len(pts) > 2:
                mx, my = pts[len(pts) // 2]
            else:
                (x1, y1), (x2, y2) = pts
                mx, my = (x1 + x2) / 2, (y1 + y2) / 2
            self.text(lx if lx is not None else mx, ly if ly is not None else my - 6, label, size, anchor,
                      halo=True, color=(None if color == INK else color), weight=weight)

    # ---- render ---------------------------------------------------------------
    def _defs(self):
        out = ["<defs>"]
        for color, key in self._marker_keys.items():
            out.append(
                f'<marker id="{self.name}-arr-{key}" viewBox="0 0 10 10" refX="9" refY="5" '
                f'markerWidth="7" markerHeight="7" orient="auto-start-reverse">'
                f'<path d="M0,0 L10,5 L0,10 z" fill="{color}"/></marker>')
        out.append("</defs>")
        return "".join(out)

    def render(self, theme):
        t = THEMES[theme]
        out = [
            f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {self.w} {self.h}" width="{self.w}" '
            f'height="{self.h}" role="img" aria-label="{escape(self.title)}" font-family="{SANS}" '
            f'color="{t["ink"]}" fill="currentColor">',
            f"<title>{escape(self.title)}</title>",
            f'<rect width="{self.w}" height="{self.h}" fill="{PAPER}"/>',
            self._defs(),
            *self.parts,
            "</svg>",
        ]
        s = "\n".join(out)
        for key in (PAPER, BLUE, TEAL, VERM):
            s = s.replace(key, t[key])
        return s
