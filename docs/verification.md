# Verification results (2026-10-15, design refinement)

All runs in a headless Linux container: Node v22, Chromium headless shell with **software WebGL (SwiftShader)**.

| Suite | Command | Result |
|---|---|---|
| Unit + integration | `npm test` | **33/33 passed** |
| Type check | `npx tsc --noEmit` | no errors |
| Deterministic evaluation | `npm run eval` | **47/47 cases**; request understanding 27/27; parsed-constraint satisfaction 95/95; actual-requirement satisfaction 95/95; impossible recognised 6/6 |
| End-to-end | `npm run test:e2e` | **7/7 passed** (30.3 min) |
| Single-file preview | `npm run build:artifact`, opened from disk | loads with no page errors; rule-based mode labelled; "I want to sleep." returns one recommended seat |
| Live-model evaluation | `npm run eval:live` | **Not run**: no API key available |

New unit tests: the three preference shortcuts map to preferences (never requirements), and the fit summary states what was asked, keeps requirements met and names one trade-off.

End-to-end tests (`tests/e2e/app.spec.ts`):
1. Adviser: "I want to sleep." gives "You asked for a window if possible and a quieter zone. This seat matches both. The trade-off is …"; the two previously failing eval cases end in a no-match that lists what would work and asks before relaxing anything; family seating (one card, three adjacent seats, party, total and per-seat prices, details folded); "Actually, £25 maximum." keeps the other requirements and marks the earlier card outdated with Select disabled; "Why not row 6?"; aisle priority; trace in About; seat taken (the card says so, the pick changes); tool timeout recovered; impossible budget; demo selection revalidated, confirmed and changed (9.9 min)
2. No duplicate submissions while a request runs; a failed message keeps a Retry with the same request id (1.9 min)
3. Camera interruption: going back mid-transition and skipping never leave the presets or Reset view disabled (3.7 min)
4. Seat chart selection; two advantages and one trade-off; Seat details with pitch separated from modelled knee space; Seated, Window and Legroom presets; Reset view in a seat view and on the seat map; Explore this seat (tray, light, shade, recline preview and Done); unsupported controls disabled on 1C; taken seats disabled; comparison with price difference, and choosing a column updates the preview; no scenery motion with reduced motion (11.1 min)
5. Mobile (390 × 844): compact sheet under 45% of the height, header, presets and sheet don't overlap, buttons at least 40 px tall, Find my seat expands the sheet, View seat collapses it, no horizontal overflow (3.6 min)
6. Without WebGL on mobile: 2D chart and adviser work; the focused composer stays in the viewport (0.8 s)
7. Loading failure: with the 3D library blocked, the 2D fallback says the preview couldn't load, and seat selection and the adviser work (1.0 s)

Screenshots in `docs/screenshots/` were inspected at 1440 × 900 and 390 × 844.

## Issues found and fixed during this refinement
- The adviser's no-match options were split inside parentheses ("34 options; lowest feasible total is £6").
- The recommendation card was hidden under the composer after a reply; the seat pass now stays put while the adviser feed scrolls (desktop), and the sheet scrolls to the reply (mobile).
- The window view was framed close to the wall with a washed-out sky; it now leans toward the nearest window, with layered glass, softer trim and a deeper sky.
- If the 3D library failed to load, the page would have tried to start the 3D cabin anyway; it now falls back to the 2D chart.

## Not verified here
- Physical phones (mobile checks used a headless 390 × 844 viewport; a real on-screen keyboard can't be simulated).
- Real-GPU frame rates. With SwiftShader, a full-screen cabin frame takes seconds, so no frame-rate figure is claimed.
- Live-model behaviour (no key).
