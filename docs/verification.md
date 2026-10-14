# Verification results (2026-10-14)

All runs in a headless Linux container: Node v22.22.0, Chromium headless shell with **software WebGL (SwiftShader)**.

| Suite | Command | Result |
|---|---|---|
| Unit + integration | `npm test` | **31/31 passed** |
| Deterministic evaluation | `npm run eval` | **47/47 cases**; request understanding 27/27; parsed-constraint satisfaction 95/95; actual-requirement satisfaction 95/95; impossible recognised 6/6 |
| End-to-end | `npm run test:e2e` | **7/7 passed** (16.3 min) |
| Live-model evaluation | `npm run eval:live` | **Not run**: no API key available |

End-to-end tests:
1. concierge: known failures, family, impossible, Arabic, multi-turn, availability, timeout, compare, select (4.6 min)
2. no duplicate submissions while a request runs; failed messages keep a retry (1.9 min)
3. camera interruption: going back mid-transition never leaves controls disabled (1.2 min)
4. cabin objects, recline preview, playground and aisle demo (5.3 min, reduced motion)
5. rendering fallback without WebGL and no horizontal overflow on mobile (0.8 s)
6. reduced motion: seat transitions complete immediately (8.9 s)
7. core journey: request → validated group → budget change → seat taken → recovery (2.8 min)

## Bugs these checks found and fixed during this iteration
- A bare "window" / "مقعد شباك" was stored as a preference (eval nofeas-05, ar-03).
- An unawaited route handler turned a 409 into an unhandled rejection that crashed the server (integration test).
- Demo selection returned outcome `info`, so the selected seats never showed in the header (e2e).
- A tween started from another tween's completion callback was dropped (e2e).
- Going back to the aircraft immediately after entering a seat built a camera path with duplicate points and stalled (e2e).
- Adding/removing the reading light changed the light count and forced every material to recompile, a 35 s stall in software rendering (probe).
- The aisle demo asked the middle passenger to move before the aisle passenger (e2e bounds check).

## Performance as measured here (software rendering, not a GPU)
Frame data captured by the app (`PERF.stats()`) during test 4:

```json
{
 "frames": 16,
 "cpuP50": 13,
 "cpuP95": 67711.7,
 "intervalP50": 100,
 "intervalP95": 233.3,
 "fpsWhileAnimating": null,
 "renderer": "ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero) (0x0000C0DE)), SwiftShader driver)",
 "pixelRatio": 1,
 "quality": "high"
}
```

With SwiftShader, an overview frame takes about 0.1–0.3 s and a full-screen cabin frame several seconds; the p95 includes one-off shader compilation for the passengers. These numbers describe this container only. No frame-rate figure for real hardware is claimed; the app shows its own measurements under Engineering → Performance and offers a Low quality mode.

## Not verified here
- Physical phones (the mobile checks used a 390 × 844 headless viewport; a real on-screen keyboard can't be simulated there).
- Real-GPU frame rates.
- Live-model behaviour (no key).
