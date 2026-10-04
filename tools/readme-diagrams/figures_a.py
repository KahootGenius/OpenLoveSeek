"""README figures, part 1: system layers, one DM turn, prompt envelope, state loop, perception."""
from svg import Canvas, tw, wrap_tokens, INK, PAPER, BLUE, TEAL, VERM

TAGCOL = {"v30": VERM, "v29": BLUE}


def chips_layout(items, x0, maxw, size=12, h=26, gap=8, rowgap=8):
    out, x, dy = [], x0, 0
    for label, tag in items:
        w = tw(label, size) + 22 + (6 if tag else 0)
        if x > x0 and x + w > x0 + maxw:
            x, dy = x0, dy + h + rowgap
        out.append((x, dy, w, label, tag))
        x += w + gap
    return out, dy + h


def draw_chips(c, chips, y, maxx, size=12, h=26):
    for x, dy, w, label, tag in chips:
        cy = y + dy
        if x + w > maxx:
            c.warn(f"chip overflows its column: {label!r}")
        c.rect(x, cy, w, h, 5, sw=0.9, fill=INK, fill_op=0.045)
        if tag:
            c.rect(x, cy, 4, h, 2, stroke=TAGCOL[tag], fill=TAGCOL[tag])
        c.text(x + w / 2 + (2 if tag else 0), cy + h / 2 + size * 0.36, label, size)


def tag_legend(c, x, y):
    a, b = "added or extended in v3.0", "added in v2.9"
    c.rect(x, y - 11, 4, 14, 2, stroke=VERM, fill=VERM)
    c.text(x + 12, y, a, 11, anchor="start")
    x2 = x + 12 + tw(a, 11) + 28
    c.rect(x2, y - 11, 4, 14, 2, stroke=BLUE, fill=BLUE)
    c.text(x2 + 12, y, b, 11, anchor="start")


def stage(c, x, y, w, h, lines, badge=None, color=None, gate=None):
    """A pipeline stage: bold title + two detail lines, optional model badge and switch note."""
    if color:
        c.rect(x, y, w, h, 8, stroke=color, sw=2, fill=color, fill_op=0.09)
    else:
        c.rect(x, y, w, h, 8)
    for i, (s, sz) in enumerate(zip(lines, (12.5, 10.5, 10.5))):
        if tw(s, sz) > w - 10:
            c.warn(f"stage text wider than box: {s!r}")
        c.text(x + w / 2, y + 23 + i * 16, s, sz, weight=(700 if i == 0 else None))
    if badge:
        c.pill(x + 8, y - 10, badge, color=color, size=9)
    if gate:
        c.text(x + w / 2, y + h + 15, gate, 10, opacity=0.65)


# ---------------------------------------------------------------------------------
def architecture():
    W, PAD, HEAD = 960, 14, 56
    ui = [("Chat list", None), ("DM chat · read receipts, voice, unsend", "v30"), ("Group chat", None),
          ("Moments feed", None), ("Personas · ⚡ Quick Start", "v29"), ("Persona editor · style panel", "v29"),
          ("Settings", "v30"), ("Prompt Studio", None), ("Context inspector", None), ("Long-press menu", None)]
    orch = [("engine.ts · DM turn", "v30"), ("groupflow.ts · group turn", None), ("feed.ts · Moments", "v30"),
            ("background.ts · outreach, deferred replies, notifications", "v30"),
            ("autoreach / outreach · when to speak first", None)]
    pure = [("perception", "v30"), ("rhythm", "v30"), ("dayseed", "v30"), ("calendar", "v30"), ("texture", "v30"),
            ("shaping", "v29"), ("statetag", "v30"), ("memory", "v30"), ("pro · state block", "v30"),
            ("prompt-envelope", "v30"), ("prompts · registry", None), ("temp", None), ("context · window", None),
            ("cutter", None), ("repair", None), ("markers", None), ("hold", None), ("tic", None),
            ("life · curve", None), ("moments", None), ("groupchat", None), ("grouproles", None),
            ("imagegen", None), ("voicetext", None), ("transfer · redpacket · games", None)]
    prov = [("llm.ts · one streaming client", "v29"), ("providers.ts · DeepSeek / GLM", "v29"),
            ("fal.ts · Seedream photos", None), ("minimax.ts · voice", None)]
    dev = [("SQLite · schema v20", "v30"), ("SecureStore · API keys", None), ("scheduled-message store", "v30"),
           ("OS notifications", None), ("media files", None), ("loveseek-native · Kotlin", None)]

    ui_ch, ui_h = chips_layout(ui, 180, 752)
    or_ch, or_h = chips_layout(orch, 180, 752)
    cols = []
    for name, sub, x, w, items in [("Pure logic", "data in, data out · unit-tested", 20, 420, pure),
                                   ("Providers", "the only network calls", 456, 244, prov),
                                   ("On device", "storage, OS, native code", 716, 224, dev)]:
        ch, hh = chips_layout(items, x + 14, w - 28)
        cols.append((name, sub, x, w, ch, hh))
    col_h = max(hh for *_, hh in cols) + HEAD + PAD
    y_ui, h_ui = 16, max(ui_h + 2 * PAD, 64)
    y_or = y_ui + h_ui + 44
    h_or = max(or_h + 2 * PAD, 64)
    y_cols = y_or + h_or + 52
    H = y_cols + col_h + 44
    c = Canvas("arch", W, H,
               "System layers: UI screens call an orchestration layer that owns every side effect; it uses pure, "
               "unit-tested logic modules, the provider clients (the only network calls) and on-device storage")

    def band(y, h, name, sub, ch):
        c.rect(20, y, 920, h, 8, sw=1, fill=INK, fill_op=0.025)
        c.text(36, y + 26, name, 15, anchor="start", weight=700)
        c.text(36, y + 44, sub, 11, anchor="start", opacity=0.7)
        draw_chips(c, ch, y + PAD, 940)

    band(y_ui, h_ui, "UI", "Expo Router screens", ui_ch)
    band(y_or, h_or, "Orchestration", "side effects, wiring", or_ch)
    for name, sub, x, w, ch, hh in cols:
        c.rect(x, y_cols, w, col_h, 8, sw=1, fill=INK, fill_op=0.025)
        c.text(x + 14, y_cols + 24, name, 15, anchor="start", weight=700)
        c.text(x + 14, y_cols + 42, sub, 11, anchor="start", opacity=0.7)
        draw_chips(c, ch, y_cols + HEAD, x + w)

    m1 = (y_ui + h_ui + y_or) / 2
    c.arrow([(480, y_ui + h_ui + 3), (480, y_or - 3)])
    c.text(492, m1 + 4, "callbacks · message subscriptions", 11, anchor="start", italic=True, opacity=0.75)
    m2 = (y_or + h_or + y_cols) / 2
    for (name, sub, x, w, ch, hh), label in zip(cols, ["state in, state out", "HTTPS · SSE streaming", "storage · schedules"]):
        cx = x + w / 2
        c.arrow([(cx, y_or + h_or + 3), (cx, y_cols - 3)])
        c.text(cx + 10, m2 + 4, label, 11, anchor="start", italic=True, opacity=0.75)
    tag_legend(c, 20, H - 16)
    c.text(940, H - 16, "seekchat/src/app · seekchat/src/lib", 10.5, anchor="end", mono=True, opacity=0.55)
    return c


# ---------------------------------------------------------------------------------
def turn():
    W, H = 960, 516
    c = Canvas("turn", W, H,
               "One DM turn in twelve stages: one perception call and one chat-model call every turn, other utility "
               "calls only when needed, and a rhythm check that can defer delivery")
    BW, BH = 146, 66
    xs = [130 + i * 164 for i in range(5)]
    ys = {"A": 66, "B": 216, "C": 366}
    for k, ls in (("A", ["BEFORE", "THE CALL"]), ("B", ["THE CALL"]), ("C", ["AFTER", "THE CALL"])):
        for i, s in enumerate(ls):
            c.eyebrow(20, ys[k] + BH / 2 + 4 - (len(ls) - 1) * 7 + i * 14, s)
    stages = [
        ("A", 0, ["1 · Burst hold", "stamps the read receipt,", "waits for typing to stop"], None, None),
        ("A", 1, ["2 · Perception", "reads the moment:", "mood, length, facts"], "utility", "switch: perception"),
        ("A", 2, ["3 · Her day", "2–3 small events,", "first turn of the day"], "utility · daily", None),
        ("A", 3, ["4 · Compose", "rules, persona, evidence,", "history window"], None, None),
        ("A", 4, ["5 · Rhythm check", "free, busy or asleep,", "by her schedule"], None, "switch: rhythm"),
        ("B", 0, ["6 · Main call", "streams the reply,", "thinking optional"], "chat model", None),
        ("B", 1, ["7 · Marker repair", "only when the lint", "finds broken syntax"], "utility · if needed", None),
        ("C", 0, ["8 · Extract", "hidden state, memory,", "texture and media"], None, None),
        ("C", 1, ["9 · Cut + typo", "long reply → bubbles,", "rare typo + *fix"], "utility · long replies", "switch: texture"),
        ("C", 2, ["10 · Persist", "bubbles: text, voice,", "unsend; photo jobs"], None, None),
        ("C", 3, ["11 · Wrap-up", "advance the style tree,", "queue a deferred reply"], None, None),
        ("C", 4, ["12 · Summarize", "rolling summary when", "history outgrows it"], "utility · threshold", None),
    ]
    for row, col, lines, badge, gate in stages:
        color = BLUE if badge == "chat model" else (TEAL if badge else None)
        stage(c, xs[col], ys[row], BW, BH, lines, badge, color, gate)
    for row in ("A", "C"):
        for i in range(4):
            y = ys[row] + BH / 2
            c.arrow([(xs[i] + BW, y), (xs[i + 1], y)])
    c.arrow([(xs[0] + BW, ys["B"] + BH / 2), (xs[1], ys["B"] + BH / 2)])
    # rhythm: continue to the main call, or branch to deferred delivery
    c.arrow([(xs[4] + 10, ys["A"] + BH), (xs[4] + 10, 186), (xs[0] + 110, 186), (xs[0] + 110, ys["B"] - 2)])
    c.arrow([(xs[4] + 134, ys["A"] + BH), (xs[4] + 134, ys["B"] - 2)], dash="5 4")
    c.text(xs[4] + 72, 174, "busy / asleep", 10.5, halo=True, mono=True)
    bx = xs[2]
    c.rect(bx, ys["B"], xs[4] + BW - bx, BH, 8, dash="5 4")
    for i, s in enumerate(["Busy: one short line now. Asleep: nothing now.",
                           "Either way the full reply is written right away and",
                           "delivered when her slot ends or she wakes (see Rhythm)."]):
        c.text(bx + (xs[4] + BW - bx) / 2, ys["B"] + 22 + i * 16, s, 11, weight=(600 if i == 0 else None))
    # repair → extract
    c.arrow([(xs[1] + BW / 2, ys["B"] + BH), (xs[1] + BW / 2, 336), (xs[0] + 110, 336), (xs[0] + 110, ys["C"] - 2)])
    ly = 472
    c.pill(130, ly - 12, "utility", color=TEAL, size=9)
    c.text(200, ly, "the provider's cheapest model with thinking off (deepseek-flash / glm-4.7-flashx)", 11, anchor="start")
    c.pill(130, ly + 12, "chat model", color=BLUE, size=9)
    c.text(222, ly + 24, "the DeepSeek or GLM model the user picked; thinking and temperature follow settings", 11, anchor="start")
    c.text(940, ly, "no badge = pure code, no model call", 10.5, anchor="end", opacity=0.75)
    return c


# ---------------------------------------------------------------------------------
def envelope():
    W, H = 960, 540
    c = Canvas("envelope", W, H,
               "Prompt envelope: instruction lanes in precedence order, core rules above the persona; model-written "
               "state rides in a second system message fenced as data; then the history window")
    LX, LW = 44, 500
    c.text(LX, 34, "System message 1 · instructions", 13, anchor="start", weight=700)
    c.text(LX, 52, "ordered by precedence; empty lanes are skipped, a key renders once", 11, anchor="start", opacity=0.7)
    tiers = [
        ("Rules that win", ["core.rules", "length.hint", "rhythm.now"],
         "the reply method, this turn's length, a busy or just-free directive", 0.09),
        ("Who the character is", ["persona", "shaping.guide", "core.truth", "moments.instructions",
                                  "persona.examples", "persona.profile"],
         "user-written persona or Quick Start guide, truth policy, voice examples", 0.035),
        ("How the hidden channels work", ["realism.rules", "usage.instructions", "memory.instructions",
                                          "tic.nudge", "variety.nudge", "markers.rules"],
         "state-tag grammar, memory writes, repetition nudges, marker rules", 0.035),
        ("Feature grammar, only what is switched on", ["texture.section", "stickers.section", "image.section",
                                                       "transfer.section", "…"],
         "each block teaches one own-line marker", 0.035),
        ("Evidence policy", ["EVIDENCE_POLICY"], "appended when evidence exists: it is data, not instructions", 0.07),
    ]
    y = 66
    top = y
    for name, keys, desc, op in tiers:
        lines = wrap_tokens(keys, LW - 28, 10.5, mono=True)
        h = 70 + 15 * (len(lines) - 1)
        c.rect(LX, y, LW, h, 7, sw=1, fill=INK, fill_op=op)
        c.text(LX + 14, y + 22, name, 12.5, anchor="start", weight=700)
        for i, ln in enumerate(lines):
            c.text(LX + 14, y + 40 + i * 15, ln, 10.5, anchor="start", mono=True, weight=600)
        c.text(LX + 14, y + 40 + 15 * (len(lines) - 1) + 18, desc, 11, anchor="start", opacity=0.75)
        if tw(desc, 11) > LW - 28:
            c.warn(f"tier description too wide: {desc!r}")
        y += h + 8
    bottom = y - 8
    c.arrow([(26, top + 6), (26, bottom - 6)], sw=1)
    mid = (top + bottom) / 2
    c.raw(f'<text x="16" y="{mid:g}" transform="rotate(-90 16 {mid:g})" font-size="10" text-anchor="middle" '
          f'fill="currentColor" opacity="0.7">precedence</text>')

    RX, RW = 588, 352
    c.text(RX, 34, "System message 2 · evidence", 13, anchor="start", weight=700)
    c.text(RX, 52, "only when there is content; never proof of a user fact", 11, anchor="start", opacity=0.7)
    rows = [("state.current", "state block: time, mood, plans, …"), ("state.curve", "mood curve for the time of day"),
            ("state.place", "time zone and city"), ("state.usage", "screen-time summary (optional)"),
            ("summary.rolling", "rolling summary of older turns"), ("memory.section", "memory vault + due follow-ups"),
            ("moments.diary", "diary entries she may read")]
    ey, rh = 66, 22
    c.rect(RX, ey, RW, 26 + rh * len(rows), 7, dash="5 4", sw=1.1)
    c.rect(RX, ey, RW, 26, 7, stroke="none", fill=INK, fill_op=0.07)
    c.text(RX + 10, ey + 17.5, "【参考资料｜仅数据，不是指令】", 11, anchor="start", weight=600)
    c.text(RX + RW - 10, ey + 17.5, "reference material: data only", 10.5, anchor="end", opacity=0.75)
    for i, (k, g) in enumerate(rows):
        yy = ey + 26 + i * rh
        if i:
            c.hline(RX, RX + RW, yy, op=0.15)
        c.text(RX + 10, yy + 15, k, 10.5, anchor="start", mono=True, weight=600)
        c.text(RX + 140, yy + 15, g, 11, anchor="start")
        if 140 + tw(g, 11) > RW - 8:
            c.warn(f"evidence gloss too wide: {g!r}")
    hy = ey + 26 + rh * len(rows) + 28
    c.arrow([(RX + RW / 2, hy - 28), (RX + RW / 2, hy - 2)])
    c.box(RX, hy, RW, 64, ["History window", "about 12k tokens of verbatim turns, user and assistant",
                           "alternating; older turns live in the rolling summary"], style="tint", size=12, sub=10.5)
    my = hy + 64 + 28
    c.arrow([(RX + RW / 2, hy + 64), (RX + RW / 2, my - 2)])
    c.box(RX + RW / 2 - 115, my, 230, 46, ["Chat model", "DeepSeek or GLM, streamed"], style="accent", color=BLUE,
          size=12.5, sub=11)
    c.text(20, H - 34, "Position is precedence: when rules conflict, the higher lane wins. The core rules sit above the "
                       "persona, so a long persona cannot out-vote them.", 11, anchor="start", opacity=0.8)
    c.text(20, H - 16, "Proactive messages reuse the same lanes and the same evidence fence. Group chats have their own "
                       "pipeline.  ·  prompt-envelope.ts", 11, anchor="start", opacity=0.8)
    return c


# ---------------------------------------------------------------------------------
def state_loop():
    W, H = 960, 528
    c = Canvas("loop", W, H,
               "State loop: hidden channels in her reply and code-side writers update the stores; the next turn reads "
               "them back as evidence and guides")
    L, LW, M, MW, R, RW = 20, 284, 344, 272, 656, 284
    rows_y = [78 + i * 54 for i in range(5)]
    BH = 44
    c.arrow([(R + RW / 2, rows_y[0] - 8), (R + RW / 2, 34), (L + LW / 2, 34), (L + LW / 2, rows_y[0] - 8)], dash="6 4")
    c.text(480, 28, "next turn: prompt → chat model → her new reply", 11.5, halo=True, weight=600)
    c.eyebrow(L, 64, "WRITTEN BY THE MODEL")
    c.eyebrow(M, 64, "STORED ON DEVICE (SQLITE v20)")
    c.eyebrow(R, 64, "READ BACK NEXT TURN")
    left = [(["Hidden state tag", "mood · thought · what she wants to bring up"], VERM),
            (["Life markers (Quick Start)", "her own schedule and interests"], None),
            (["Reply text + texture markers", "bubbles · unsend · quote · voice note"], VERM),
            (["Memory marker", "fallback when perception is off"], None)]
    stores = [["conversations", "mood · thought · agenda · closeness · summary"],
              ["personas", "style tree · schedule · interests · day log"],
              ["messages", "bubbles · read receipts · kinds · quotes"],
              ["memories", "facts about the user · follow-up dates"],
              ["scheduled-message store", "deferred replies · proactive messages"]]
    right = [(["State block (evidence)", "mood · thought · agenda · events · closeness"], VERM),
             (["Style guide (Quick Start)", "settled styles · current probe · self-portrait"], None),
             (["Chat screen", "read receipts · unsend notes · voice bubbles"], VERM),
             (["Memory block (evidence)", "facts + follow-ups that are due"], None),
             (["Delivered on time", "a deferred reply folds into the chat"], VERM)]
    for i, (lines, col) in enumerate(left):
        y = rows_y[i]
        c.box(L, y, LW, BH, lines, size=11.5, sub=10.5)
        if col:
            c.rect(L, y, 4, BH, 2, stroke=col, fill=col)
        c.arrow([(L + LW, y + BH / 2), (M, y + BH / 2)])
    for i, lines in enumerate(stores):
        y = rows_y[i]
        c.box(M, y, MW, BH, lines, style="tint", size=11.5, sub=10.5)
        c.arrow([(M + MW, y + BH / 2), (R, y + BH / 2)])
    for i, (lines, col) in enumerate(right):
        y = rows_y[i]
        c.box(R, y, RW, BH, lines, size=11.5, sub=10.5)
        if col:
            c.rect(R + RW - 4, y, 4, BH, 2, stroke=col, fill=col)
    bus = rows_y[4] + BH + 40
    c.hline(130, 830, bus, op=0.7)
    c.arrow([(M + MW / 2, bus), (M + MW / 2, rows_y[4] + BH + 4)])
    c.text(M + MW / 2 + 10, bus - 12, "code writes into the same stores (no model markers)", 11, anchor="start", italic=True, opacity=0.8)
    code = [(["Perception · every turn", "facts · follow-ups · closeness · verdict"], TEAL),
            (["Day seed · once a day", "2–3 small events → day log"], TEAL),
            (["Rhythm · pure code", "read receipts · deferred replies"], None),
            (["Turn close · pure code", "advance the style tree · mood growth"], None)]
    for i, (lines, col) in enumerate(code):
        x = 20 + i * 232
        c.line([(x + 110, bus), (x + 110, bus + 22)], arrow=False)
        c.box(x, bus + 22, 220, 46, lines, style=("accent" if col else "plain"), color=col, size=11.5, sub=10.5)
    c.text(20, H - 16, "Red edge = channels added in v3.0. Model-written state is fenced as evidence; the user's own "
                       "words always win over it.", 11, anchor="start", opacity=0.8)
    return c


# ---------------------------------------------------------------------------------
def perception():
    W, H = 960, 530
    c = Canvas("perception", W, H,
               "Perception: five inputs enter one cheap utility call; each field of its one-line JSON answer feeds a "
               "different part of the system")
    FY0, FH, FS = 56, 38, 52
    fields_mid = FY0 + (7 * FS + FH) / 2
    c.eyebrow(20, 40, "INPUTS")
    c.eyebrow(452, 40, "JSON FIELDS")
    c.eyebrow(630, 40, "WHERE EACH FIELD GOES")
    inputs = [(["Her last turn", "tags stripped, excerpted"], "plain"),
              (["The user's new messages", "empty on a trigger turn"], "plain"),
              (["Known memories", "so nothing is stored twice"], "plain"),
              (["Today", "date and weekday"], "plain"),
              (["Style-tree state", "Quick Start personas only"], "dashed")]
    iy0 = fields_mid - (4 * 62 + 48) / 2
    for i, (lines, style) in enumerate(inputs):
        y = iy0 + i * 62
        c.box(20, y, 200, 48, lines, style=style, size=12, sub=10.5)
        c.arrow([(220, y + 24), (262, fields_mid - 48 + i * 24)])
    cy = fields_mid - 72
    c.rect(262, cy, 150, 144, 10, stroke=TEAL, sw=2.2, fill=TEAL, fill_op=0.09)
    c.text(337, cy + 38, "Perception", 15, weight=700)
    c.text(337, cy + 60, "utility model", 11)
    c.text(337, cy + 76, "temperature 0", 11)
    c.text(337, cy + 92, "one line of strict JSON", 11)
    c.text(337, cy + 118, "perception.ts", 10, mono=True, opacity=0.65)
    fields = [("register", ["temperature", "strict / balanced / wild (dynamic mode)"], False),
              ("length", ["length line", "short / medium / long, under the core rules"], False),
              ("userMood", ["state block", "“the user seems: happy / down / …”"], False),
              ("facts[]", ["memory vault", "up to 2 new facts a turn, de-duplicated"], False),
              ("followUps[]", ["dated follow-ups", "due ones reach the state block and outreach"], False),
              ("closeness", ["closeness score", "0–100, ±1 per turn, starts at 40"], False),
              ("birthday", ["the user's birthday", "→ countdown in the calendar line"], False),
              ("attitude · selfFacts · name", ["Quick Start state", "style verdict · self-portrait · her name"], True)]
    for i, (f, sink, qs) in enumerate(fields):
        y = FY0 + i * FS
        if qs:
            c.rect(452, y, 150, FH, 6, dash="5 4")
            c.text(527, y + 16, "attitude · selfFacts", 10, mono=True, weight=600)
            c.text(527, y + 30, "· name", 10, mono=True, weight=600)
        else:
            c.rect(452, y, 150, FH, 6, fill=INK, fill_op=0.06)
            c.text(527, y + FH / 2 + 4, f, 11, mono=True, weight=600)
        c.arrow([(412, fields_mid), (452, y + FH / 2)])
        c.arrow([(602, y + FH / 2), (630, y + FH / 2)])
        c.box(630, y, 310, FH, sink, style=("dashed" if qs else "plain"), size=11.5, sub=10.5, lh=15)
    c.text(20, H - 34, "One call replaces two v2.9 calls: the register / length classifier and the Quick Start observer.",
           11, anchor="start", opacity=0.8)
    c.text(20, H - 16, "On a trigger turn (no user reply) register, length and attitude are discarded. If the call fails, "
                       "the turn runs on manual settings and writes nothing.", 11, anchor="start", opacity=0.8)
    return c
