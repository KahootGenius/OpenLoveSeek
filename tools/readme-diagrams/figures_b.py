"""README figures, part 2: rhythm, the Quick Start style tree, a dimension's lifecycle,
acting vs judging across turns, and how the project was built."""
from svg import Canvas, tw, INK, PAPER, BLUE, TEAL, VERM


# ---------------------------------------------------------------------------------
def rhythm():
    W, H = 960, 578
    c = Canvas("rhythm", W, H,
               "Rhythm: with a schedule, her current activity decides between an ordinary reply, one short busy line "
               "now with the full reply at the slot's end, or silence until she wakes")
    c.box(20, 126, 128, 50, ["User message", "not a trigger turn"], style="tint", size=12, sub=10.5)
    c.arrow([(148, 151), (157, 151)])
    c.diamond(232, 151, 150, 96, ["rhythm switch on", "and she has", "a schedule?"], size=10.5)
    c.arrow([(232, 103), (232, 64), (680, 64)], label="no → ordinary reply", lx=330, ly=58)
    c.arrow([(307, 151), (335, 151)], label="yes", lx=321, ly=141)
    c.diamond(410, 151, 150, 88, ["her activity", "right now?"], size=11)
    c.line([(410, 107), (410, 64)], arrow=False)
    c.dot(410, 64, 3)
    c.text(418, 92, "free", 10.5, anchor="start", halo=True)
    c.arrow([(485, 151), (508, 151)], label="busy", lx=496, ly=141)
    c.text(420, 212, "busy = work, meetings, class,", 10, anchor="start", opacity=0.7)
    c.text(420, 226, "gym, shower, cooking, …", 10, anchor="start", opacity=0.7)
    c.diamond(578, 151, 140, 80, ["short line already", "sent this slot?"], size=10.5)
    c.arrow([(648, 151), (680, 151)], label="no", lx=664, ly=141)
    c.line([(578, 191), (578, 290)], arrow=False)
    c.dot(578, 290, 3)
    c.text(586, 250, "yes: one per slot", 10.5, anchor="start", halo=True)
    c.arrow([(410, 195), (410, 290), (680, 290)], label="asleep", lx=500, ly=284)
    c.box(680, 40, 260, 48, ["now · ordinary reply", "read receipt in 3–45 seconds"], size=11.5, sub=10.5)
    c.box(680, 127, 260, 48, ["short · one line now: “busy, later”", "full reply lands when the slot ends"],
          style="accent", color=VERM, size=11.5, sub=10.5)
    c.text(810, 192, "the full reply is written now, delivered later", 10, opacity=0.65)
    c.box(680, 262, 260, 56, ["defer · nothing now", "full reply lands at wake-up + 3–20 min,", "or slot end + 1–5 min"],
          style="tint", size=11.5, sub=10.5)

    c.hline(20, 940, 334, op=0.2)
    notes = [
        "Read receipts are stamped when the user sends: free +3–45 s · busy within 3–15 min, by the slot's end · asleep at wake-up +2–10 min.",
        "A deferred reply is written immediately under a “you just got free” directive, then handed to the scheduled-message store with an OS notification.",
        "It folds into the chat at its time with no trigger row and is never treated as stale.",
    ]
    for i, n in enumerate(notes):
        c.text(20, 354 + i * 16, n, 10.5, anchor="start", opacity=0.85)

    x0, x1, y = 50, 930, 506
    px = (x1 - x0) / 24.0
    X = lambda h: x0 + h * px
    c.eyebrow(20, 404, "A WORKED DAY · sleep 23:30–07:00 · work 09:00–18:00")
    for a, b, label in ((0, 7, "asleep"), (9, 18, "at work"), (23.5, 24, None)):
        c.rect(X(a), y - 10, X(b) - X(a), 20, 4, sw=0.6, fill=INK, fill_op=0.08)
        if label:
            c.text((X(a) + X(b)) / 2, y + 4, label, 10, opacity=0.7)
    c.hline(x0, x1, y, op=0.6)
    for h in range(0, 25, 3):
        c.vline(X(h), y + 10, y + 16, op=0.6)
        c.text(X(h), y + 30, f"{h % 24:02d}:00", 9.5, mono=True, opacity=0.7)

    def ev(h, label, hers, dy, side="middle"):
        x = X(h)
        col = VERM if hers else INK
        c.vline(x, y - 12, y - dy + 6, op=0.8, color=col, sw=1.2)
        c.dot(x, y - dy, 3.5, color=col)
        tx, ty = {"middle": (x, y - dy - 8), "left": (x - 7, y - dy + 4), "right": (x + 7, y - dy + 4)}[side]
        anchor = {"middle": "middle", "left": "end", "right": "start"}[side]
        c.text(tx, ty, label, 10, anchor=anchor, color=(VERM if hers else None),
               weight=(600 if hers else None), halo=True)

    ev(1 + 10 / 60, "01:10 user writes", False, 26)
    ev(7 + 6 / 60, "07:06 read", False, 40, "left")
    ev(7 + 12 / 60, "07:12 full reply lands", True, 62, "right")
    ev(14 + 2 / 60, "14:02 user writes", False, 40, "left")
    ev(14 + 3 / 60, "14:03 “in a meeting, later”", True, 62, "right")
    ev(18 + 3 / 60, "18:03 full reply lands", True, 26)
    c.text(20, H - 12, "rhythm.ts · availabilityAt / computeReadAt / decideRhythm  ·  background.ts · scheduleDeferredReply",
           10, anchor="start", mono=True, opacity=0.55)
    return c


# ---------------------------------------------------------------------------------
def shaping_tree():
    W, H = 960, 498
    c = Canvas("tree", W, H,
               "Quick Start style tree: five dimensions in probe order; in this example snapshot each dimension's "
               "variants are settled, excluded, being probed, or still open")
    c.box(14, 43, 140, 68, ["One-line persona", "“You're my girlfriend,", "female, 23–27.”"], style="tint", size=11.5, sub=11)
    c.text(84, 128, "personas.shaping", 10, mono=True, opacity=0.6)
    c.arrow([(154, 77), (168, 77)])
    BW = 140
    xs = [168 + i * 156 for i in range(5)]
    dims = [("① Tone 语气", "settled", None), ("② Clinginess 黏人度", "settled · auto", None),
            ("③ Initiative 主动性", "probing", VERM), ("④ Affection 亲密表达", "open", None),
            ("⑤ Nagging 管束", "open", None)]
    for (label, chip, col), x in zip(dims, xs):
        c.box(x, 60, BW, 34, label, style="tint", size=12)
        cw = tw(chip, 9, mono=True) + 14
        c.pill(x + BW - 6 - cw, 98, chip, color=(col or INK), size=9, filled=False)
    for i in range(4):
        c.arrow([(xs[i] + BW, 77), (xs[i + 1], 77)])
    c.text(244, 52, "probe order →", 10, mono=True, opacity=0.6)

    def variant(x, y, label, sub, kind):
        h = 44
        if kind == "settled":
            c.rect(x, y, BW, h, 6, fill=INK)
            c.text(x + BW / 2, y + 19, "✓ " + label, 12, color=PAPER, weight=600)
            c.text(x + BW / 2, y + 35, sub, 10, color=PAPER, opacity=0.85)
        elif kind == "excluded":
            c.rect(x, y, BW, h, 6, dash="5 4", sw=1)
            c.text(x + BW / 2, y + 19, "✕ " + label, 12, opacity=0.55)
            c.text(x + BW / 2, y + 35, sub, 10, opacity=0.55)
        elif kind == "probe":
            c.rect(x, y, BW, h, 6, stroke=VERM, sw=2.5, fill=VERM, fill_op=0.09)
            c.text(x + BW / 2, y + 19, "● " + label, 12, weight=600)
            c.text(x + BW / 2, y + 35, sub, 10, color=VERM, weight=600)
        elif kind == "open":
            c.rect(x, y, BW, h, 6)
            c.text(x + BW / 2, y + 19, label, 12)
            c.text(x + BW / 2, y + 35, sub, 10, opacity=0.6)
        else:
            c.rect(x, y, BW, h, 6, sw=0.8, opacity=0.35)
            c.text(x + BW / 2, y + 19, label, 12, opacity=0.4)
            c.text(x + BW / 2, y + 35, sub, 10, opacity=0.4)
        for s, sz in ((label, 12), (sub, 10)):
            if tw(s, sz) + (14 if sz == 12 else 0) > BW - 8:
                c.warn(f"variant text tight: {s!r}")

    ys = [128, 184, 240]
    variant(xs[0], ys[0], "Soft & coquettish", "turn 2: liked → settled", "settled")
    variant(xs[0], ys[1], "Playful & goofy", "never reached", "faint")
    variant(xs[0], ys[2], "Calm & cool", "never reached", "faint")
    variant(xs[1], ys[0], "Clingy", "disliked → excluded", "excluded")
    variant(xs[1], ys[1], "Independent", "last one left → settled", "settled")
    variant(xs[2], ys[0], "Takes the lead", "acting · turn 2 of 3", "probe")
    variant(xs[2], ys[1], "Goes along", "untried · next in line", "open")
    variant(xs[3], ys[0], "Direct", "open", "open")
    variant(xs[3], ys[1], "Subtle", "open", "open")
    variant(xs[4], ys[0], "Nags you", "open", "open")
    variant(xs[4], ys[1], "Hands-off", "open", "open")
    cx = xs[2] + BW / 2
    c.line([(cx, 300), (cx, 288)], color=VERM, sw=1.5)
    c.text(cx, 316, "probe = Initiative / Takes the lead · turns 2 · tried [Takes the lead]", 10, color=VERM, mono=True, weight=600)
    c.text(cx, 332, "lastActed = Takes the lead: what she actually acted last turn, which perception grades", 10.5, opacity=0.75)

    ly = 370
    c.hline(14, 946, 354, op=0.2)
    c.eyebrow(14, ly, "LEGEND")
    items = [("settled", "settled (liked, or last one left)"), ("excluded", "excluded (disliked)"),
             ("probe", "being probed"), ("open", "open"), ("faint", "never reached")]
    x = 84
    for kind, label in items:
        y = ly - 12
        if kind == "settled":
            c.rect(x, y, 26, 16, 4, fill=INK)
        elif kind == "excluded":
            c.rect(x, y, 26, 16, 4, dash="4 3", sw=1)
        elif kind == "probe":
            c.rect(x, y, 26, 16, 4, stroke=VERM, sw=2, fill=VERM, fill_op=0.09)
        elif kind == "open":
            c.rect(x, y, 26, 16, 4)
        else:
            c.rect(x, y, 26, 16, 4, sw=0.8, opacity=0.35)
        c.text(x + 34, ly, label, 11, anchor="start")
        x += 34 + tw(label, 11) + 30
    notes = [
        "Code, not the model, picks the probe: the first open dimension from left to right, one variant at a time, for at most three turns.",
        "The character only acts the variant. A separate cheap call judges the user's reaction: liked settles it, disliked excludes it.",
        "Settled styles are restated in her guide every turn. The state is plain data (shaping.ts); this snapshot is an example, not a script.",
    ]
    for i, n in enumerate(notes):
        c.text(14, 408 + i * 18, n, 11, anchor="start", opacity=0.82)
    c.text(14, H - 14, "shaping.ts · STYLE_TREE / nextProbe / ShapingState", 10, anchor="start", mono=True, opacity=0.55)
    return c


# ---------------------------------------------------------------------------------
def lifecycle():
    W, H = 960, 456
    c = Canvas("life", W, H,
               "Lifecycle of one style dimension: the probing variant is settled, excluded or rotated by the "
               "perception verdict; one candidate left settles automatically, none left skips")
    c.text(20, 26, "Verdicts (likes / dislikes / neutral) come from the perception call and grade lastActed, the variant she actually acted.",
           11, anchor="start", opacity=0.8)
    c.box(30, 160, 130, 64, ["Dimension open", "not settled,", "not skipped"], size=11.5, sub=10.5)
    c.rect(210, 150, 180, 84, 8, stroke=VERM, sw=2.2, fill=VERM, fill_op=0.09)
    c.text(300, 172, "Probing", 13, weight=700)
    c.text(300, 190, "acts variant Vi", 11)
    c.text(300, 205, "turns +1 each turn", 11)
    c.text(300, 221, "turn close: lastActed = Vi", 10, opacity=0.8)
    c.diamond(550, 192, 150, 84, ["exclude Vi;", "candidates left?"], size=11)
    c.rect(710, 30, 170, 64, 8, fill=INK)
    c.text(795, 52, "Settled", 13, color=PAPER, weight=700)
    c.text(795, 68, "restated in the guide every turn;", 9.5, color=PAPER, opacity=0.85)
    c.text(795, 82, "the probe moves to the next one", 9.5, color=PAPER, opacity=0.85)
    c.rect(710, 290, 170, 64, 8, dash="5 4")
    c.text(795, 312, "Skipped", 13, weight=700)
    c.text(795, 328, "the probe moves on;", 9.5, opacity=0.8)
    c.text(795, 342, "the dimension stays open", 9.5, opacity=0.8)
    c.arrow([(160, 192), (210, 192)])
    c.text(185, 176, "first", 9.5, halo=True)
    c.text(185, 186, "candidate", 9.5, halo=True)
    c.arrow([(370, 150), (370, 62), (710, 62)], label="likes → settle", lx=540, ly=57)
    c.arrow([(390, 192), (475, 192)], label="dislikes", lx=432, ly=181)
    c.arrow([(550, 150), (550, 88), (710, 88)], label="1 left → auto-settle", lx=630, ly=83)
    c.arrow([(625, 192), (670, 192), (670, 322), (710, 322)])
    c.text(678, 262, "0 left", 11, anchor="start", halo=True)
    c.text(678, 277, "→ skip", 11, anchor="start", halo=True)
    c.arrow([(550, 234), (550, 275), (360, 275), (360, 234)], label="≥2 left → switch to an untried one now", lx=490, ly=291)
    c.curve("M 232,150 C 232,104 340,104 340,150", color=VERM, sw=1.4)
    c.text(286, 112, "3 turns, no verdict, untried left → rotate", 10, halo=True, color=VERM, weight=600)
    c.curve("M 232,234 C 232,282 310,282 310,234")
    c.text(290, 299, "neutral → keep acting", 10, halo=True)
    c.arrow([(220, 234), (220, 380), (795, 380), (795, 354)], dash="5 4",
            label="3 turns, no verdict, nothing untried → skip", lx=548, ly=395)
    c.arrow([(845, 290), (845, 94)])
    c.text(853, 186, "a later", 10, anchor="start")
    c.text(853, 200, "likes still", 10, anchor="start")
    c.text(853, 214, "settles it", 10, anchor="start", opacity=0.75)
    c.hline(20, 940, 414, op=0.2)
    c.text(20, 432, "After a settle or skip the probe moves to the next open dimension; when all five are settled or skipped, "
                    "her guide says “keep who you are now”.", 10.5, anchor="start", opacity=0.8)
    c.text(20, 448, "shaping.ts · applyJudgement / advanceTurn", 10, anchor="start", mono=True, opacity=0.55)
    return c


# ---------------------------------------------------------------------------------
def act_judge():
    W, H = 960, 446
    c = Canvas("actjudge", W, H,
               "Acting and judging are separate calls: the probe rotates when turn N closes, so turn N+1's perception "
               "credits the user's reaction to lastActed, the variant she actually acted, before she acts again")
    for name, y in (("User", 70), ("Perception call", 150), ("Main call", 230), ("Style-tree state", 330)):
        c.text(20, y + 4, name, 12, anchor="start", weight=600)
    for y in (110, 190, 270):
        c.hline(140, 940, y, op=0.15)
    c.eyebrow(150, 30, "TURN N")
    c.eyebrow(496, 30, "TURN N+1")
    c.vline(476, 20, 380, op=0.5, dash="4 4")
    c.text(476, 396, "turn boundary", 10, mono=True, opacity=0.7)

    c.box(150, 205, 300, 50, ["Main call (chat model)", "guide: probe “Takes the lead” · turn 3 of 3"],
          style="accent", color=BLUE, size=11.5, sub=10.5)
    c.arrow([(300, 255), (300, 298)])
    c.text(310, 282, "turn closes", 10, anchor="start", halo=True)
    c.box(150, 300, 310, 62, ["advanceTurn: lastActed = Takes the lead", "turns 3 ≥ 3 → rotate: probe = Goes along",
                              "saved to personas.shaping"], style="tint", size=11, sub=10.5)

    c.box(496, 45, 124, 50, ["User replies", "after the burst hold"], size=11.5, sub=10)
    c.arrow([(558, 95), (558, 112), (670, 112), (670, 126)])
    c.text(678, 108, "opens turn N+1", 10, anchor="start", halo=True)
    c.box(548, 128, 256, 50, ["Perception (utility model)", "last turn + reply + lastActed ⇒ “likes”"],
          style="accent", color=TEAL, size=11.5, sub=10.5)
    c.arrow([(460, 331), (500, 331), (500, 153), (548, 153)], dash="5 4")
    c.text(508, 232, "lastActed travels", 10, anchor="start", opacity=0.8)
    c.text(508, 246, "with the saved state", 10, anchor="start", opacity=0.8)
    c.arrow([(740, 178), (740, 298)])
    c.text(732, 268, "applyJudgement", 10, anchor="end", mono=True, halo=True)
    c.box(548, 300, 256, 62, ["“likes” goes to lastActed (Takes the lead),", "not the rotated probe (Goes along):",
                              "settled; the probe moves to Affection"], style="accent", color=VERM, size=10.5, sub=10.5)
    c.arrow([(804, 331), (812, 331), (812, 230), (820, 230)])
    c.box(820, 205, 120, 50, ["Main call", "acts “Direct”"], style="accent", color=BLUE, size=11.5, sub=10.5)
    c.arrow([(880, 255), (880, 298)])
    c.box(820, 300, 120, 62, ["advanceTurn", "lastActed = Direct", "probe: 1 turn"], style="tint", size=11, sub=10.5)
    c.hline(20, 940, 410, op=0.2)
    c.text(20, 426, "If perception fails, or on a trigger turn with no user reply, the attitude is dropped and the tree stays put.",
           10.5, anchor="start", opacity=0.8)
    c.text(20, 441, "The rotation at the boundary is why lastActed exists: a verdict must land on the variant she actually acted.",
           10.5, anchor="start", opacity=0.8)
    return c


# ---------------------------------------------------------------------------------
def workflow():
    W, H = 960, 416
    c = Canvas("workflow", W, H,
               "How it was built: KahootGenius asks or reports, Claude Code assesses, KahootGenius decides, "
               "Claude Code builds and verifies, KahootGenius tests the APK on a phone, and the loop repeats")
    lanes = [(40, "KahootGenius", ["design", "testing · reporting"]), (220, "Claude Code", ["coding", "code-level debugging"])]
    for y, name, subs in lanes:
        c.rect(20, y, 920, 150, 10, sw=1, fill=INK, fill_op=0.03)
        c.text(36, y + 32, name, 15, anchor="start", weight=700)
        for i, s in enumerate(subs):
            c.text(36, y + 52 + i * 16, s, 11, anchor="start", opacity=0.75)
    NW, NH = 136, 78
    xs = [176 + i * 152 for i in range(5)]
    top_y, bot_y = 70, 250
    nodes = [
        (0, top_y, ["Asks or reports", "a feature to build, or", "a bug seen on device"], "NEXT.md backlog"),
        (1, bot_y, ["Assesses", "proposes a design, or", "root-causes the bug"], "options + a recommendation"),
        (2, top_y, ["Decides", "approves, adjusts or", "redirects the design"], "approved spec"),
        (3, bot_y, ["Builds", "spec → plan → TDD →", "review → APK"], "specs · plans · 641 tests"),
        (4, top_y, ["Tests", "installs the APK and", "uses it day to day"], "field reports → NEXT.md"),
    ]
    for col, y, lines, artifact in nodes:
        x = xs[col]
        top = y == top_y
        c.box(x, y, NW, NH, lines, style=("tint" if top else "accent"), color=(None if top else BLUE), size=12.5, sub=10.5, lh=17)
        c.text(x + NW / 2, y + NH + 16, artifact, 10, mono=True, opacity=0.65)
    links = [("asks / reports", 0, 1), ("recommends", 1, 2), ("go-ahead", 2, 3), ("APK", 3, 4)]
    for label, a, b in links:
        ax, ay = xs[a] + NW / 2, (top_y + NH if a in (0, 2, 4) else bot_y)
        bx, by = xs[b] + NW / 2, (bot_y if b in (1, 3) else top_y + NH)
        ax2 = ax + (24 if a in (0, 2, 4) else 24)
        bx2 = bx - 24
        p1 = (ax2, ay + (22 if a in (0, 2, 4) else 0))
        p2 = (bx2, by - (0 if b in (1, 3) else -22))
        c.arrow([p1, p2])
        t = (210 - p1[1]) / (p2[1] - p1[1])
        lx = p1[0] + t * (p2[0] - p1[0])
        down = p2[1] > p1[1]
        c.text(lx - 9 if down else lx + 9, 210, label, 10.5, anchor=("end" if down else "start"),
               italic=True, halo=True, opacity=0.85)
    c.arrow([(xs[4] + NW / 2, top_y), (xs[4] + NW / 2, 22), (xs[0] + NW / 2, 22), (xs[0] + NW / 2, top_y)], dash="6 4")
    c.text((xs[0] + xs[4] + NW) / 2, 16, "next request or field report", 10.5, italic=True, halo=True, opacity=0.85)
    c.text(20, H - 16, "Claude Code ran on Claude Fable 5 and Claude Opus 4.8 (v1.0–v2.7), Claude Fable 5.1 (v2.8–v3.0) "
                       "and Claude Opus 5.5 (this README).", 11, anchor="start", opacity=0.8)
    return c
