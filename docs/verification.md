# Verification results (2026-10-14, simplified version)

All runs in a headless Linux container: Node v22, Chromium headless shell with **software WebGL (SwiftShader)**.

| Suite | Command | Result |
|---|---|---|
| Unit + integration | `npm test` | **31/31 passed** |
| Type check | `npx tsc --noEmit` | no errors |
| Deterministic evaluation | `npm run eval` | **47/47 cases**; request understanding 27/27; parsed-constraint satisfaction 95/95; actual-requirement satisfaction 95/95; impossible recognised 6/6 |
| End-to-end | `npm run test:e2e` | **6/6 passed** (18.2 min) |
| Single-file preview | `npm run build:artifact`, opened from disk | loads with no page errors; rule-based mode labelled; family request returns one best card |
| Live-model evaluation | `npm run eval:live` | **Not run**: no API key available |

End-to-end tests (`tests/e2e/app.spec.ts`):
1. Assistant: the two previously failing eval cases; family seating (one best card, three adjacent seats, total and per-seat prices, details folded); "Actually, £25 maximum." changes only the budget and marks the earlier card outdated with Select disabled; "Why not row 6?"; "I care more about getting out easily."; the trace in About; a recommended seat taken (snapshot v2, new pick); tool timeout recovered; impossible budget; demo selection revalidated, nothing booked (4.4 min)
2. No duplicate submissions while a request runs; a failed message keeps a Retry with the same request id (2.0 min)
3. Camera interruption: going back mid-transition and skipping never leave the view controls disabled (1.8 min)
4. Seat selection from the seat map; From seat, Window and Legroom views; pitch, price and aisle-access text; taken seats disabled; comparison table; no character, playground or object-control code or UI remains; no scenery motion with reduced motion (7.7 min)
5. Mobile (390 × 844): compact bottom sheet under 45% of the height, header controls don't overlap, no horizontal overflow, the sheet expands for the assistant and collapses for "View seat" (2.2 min)
6. Without WebGL on mobile: 2D note, seat map and assistant work; the focused composer stays in the viewport (0.8 s)

## Issues found and fixed during this simplification
- The requirement summary on recommendation cards was cut off at the colon in "demo policy: no exit rows with children".
- On mobile, the About button and the view tabs overlapped.
- The window view used a fixed angle close to the wall; it now aims at the nearest window.
- When a recommended seat was taken, the new card showed the new pick without saying why it changed.
- A leftover comment claimed a user-switchable quality setting that no longer existed; quality now drops automatically if frames stay slow.

## Not verified here
- Physical phones (mobile checks used a headless 390 × 844 viewport; a real on-screen keyboard can't be simulated).
- Real-GPU frame rates. With SwiftShader, a full-screen cabin frame takes seconds, so no frame-rate figure is claimed.
- Live-model behaviour (no key).
