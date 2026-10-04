"""Build the README diagrams into docs/readme/ (light + dark SVG per figure).

    python3 tools/readme-diagrams/build.py

Python 3 standard library only. Layout warnings print when a label is likely
to overflow its box; fix those before committing new SVGs.
"""
import os
import sys

sys.dont_write_bytecode = True  # keep __pycache__ out of the repo
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

from svg import WARNINGS  # noqa: E402
from figures_a import architecture, turn, envelope, state_loop, perception  # noqa: E402
from figures_b import rhythm, shaping_tree, lifecycle, act_judge, workflow  # noqa: E402

OUT = os.path.normpath(os.path.join(HERE, "..", "..", "docs", "readme"))
FIGURES = [
    ("architecture", architecture), ("turn", turn), ("envelope", envelope), ("state-loop", state_loop),
    ("perception", perception), ("rhythm", rhythm), ("shaping-tree", shaping_tree),
    ("shaping-lifecycle", lifecycle), ("act-judge", act_judge), ("workflow", workflow),
]


def main():
    os.makedirs(OUT, exist_ok=True)
    for slug, build in FIGURES:
        canvas = build()
        for theme in ("light", "dark"):
            with open(os.path.join(OUT, f"{slug}-{theme}.svg"), "w", encoding="utf-8") as f:
                f.write(canvas.render(theme))
        print(f"{slug:18} {canvas.w}x{canvas.h}")
    if WARNINGS:
        print("\nlayout warnings:")
        for w in WARNINGS:
            print("  " + w)
    else:
        print("\nno layout warnings")


if __name__ == "__main__":
    main()
