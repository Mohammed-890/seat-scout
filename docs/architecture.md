# Architecture and trust boundaries

```mermaid
flowchart LR
  subgraph Browser["Browser (no keys, no model calls)"]
    UI["3D cabin + seat chart<br/>adviser chat<br/>About: trace + evaluation"]
  end
  subgraph Server["Node server: trust boundary"]
    API["HTTP API<br/>HttpOnly session cookie<br/>zod-validated bodies, rate limit"]
    AG["Agent loop (bounded)<br/>≤8 steps · model 30 s · tool 3 s<br/>fallback: rule-based planner"]
    TOOLS["Tools (zod-validated)<br/>updateTripPreferences · findAdjacentSeatGroups<br/>searchAvailableSeats · getSeatEvidence<br/>compareSeatOptions · validateRecommendation<br/>submitRecommendation · getCabinConfiguration"]
    CORE["Deterministic core<br/>constraints · adjacency · demo policy<br/>arithmetic · scoring · validation · explanations"]
    DATA[("Synthetic data<br/>cabin config + provenance<br/>demo policy · snapshots v1, v2…<br/>per-session trip state")]
  end
  LLM["Claude (Anthropic API)"]
  UI -- "text, demo controls" --> API --> AG
  AG <-- "messages + tool schemas" --> LLM
  AG --> TOOLS --> CORE --> DATA
  API -- "NDJSON: live trace events,<br/>then message, validated cards, trace" --> UI
```

## Request flow (one turn)
1. **Request**: the passenger message arrives with the session's state revision and availability snapshot version.
2. **Interpretation**: Claude reads the message plus the *structured* trip state (not the whole raw chat) and calls `updateTripPreferences` with only the changed fields. In no-key mode, the rule-based parser produces the same patch.
3. **Search**: `findAdjacentSeatGroups` enumerates every side-by-side group of the right size, applies hard constraints (availability, total or per-seat budget, demo eligibility policy, must-haves) with explicit exclusion reasons, and ranks the rest by named preference components. If nothing fits, it returns a relaxation analysis.
4. **Validation**: the model validates its picks and then submits. The application **re-validates** everything against the latest snapshot, recomputes totals and builds the cards from the dataset. Invalid picks are dropped and the turn says so; after two rejected submissions it falls back to the deterministic planner.
5. **Trace**: every step is recorded as an application event (the arguments, results, exclusions, scores, validation, model usage and latency), not hidden reasoning.
6. **Progress**: when the client asks for `application/x-ndjson`, each trace event is streamed as it is recorded, then the final result. The progress line in the chat is built only from these events.

## Request handling guarantees
- **One turn at a time per session.** A second turn that arrives while one is running gets `409` instead of interleaving state patches.
- **Idempotent retries.** The client sends a random `clientId` per message and reuses it on Retry. If the first attempt actually finished (for example the connection dropped after the server answered), the stored result is returned with `replayed: true`, and the turn is not applied twice.
- **No duplicate submissions in the UI.** The composer is locked while a request runs; a failed message stays in the conversation with a Retry button.

## Evaluation metrics (and why there are four)
`eval/checks.ts` reports, each with numerator and denominator:
- **Request understanding**: requirements the passenger stated (`expect.requires` and the older per-field expectations) that are present in the final structured state.
- **Parsed-constraint satisfaction**: shown seat groups that meet the constraints *the system recorded*. This is what a solver can guarantee, and it cannot catch a requirement the parser never recorded.
- **Actual-requirement satisfaction**: shown seat groups that meet what the passenger *asked for*.
- **Impossible-request recognition**: cases with no feasible answer that end with no seats and an explanation.

Before the parser fix, parsed-constraint satisfaction was 101/101 while actual-requirement satisfaction was 95/101 and request understanding 20/27. A single "hard constraints 100%" figure had hidden that gap.

## Trust boundaries
| Boundary | What is protected | How |
|---|---|---|
| Client ↔ server | API key, other sessions | Key only in the server environment; trace values whose keys look like keys or tokens are redacted; random 128-bit HttpOnly SameSite cookie; per-session state and availability |
| Model ↔ business rules | Prices, eligibility, adjacency, availability | The model never computes them: tools do, and the app re-validates every proposal |
| Untrusted text ↔ instructions | Prompt injection via user or retrieved text | Passenger tips are returned as `{untrusted: true}` data; the system prompt says not to follow them; the user can't change the demo policy; evaluated in the `override_attempt` cases |
| Input ↔ state | Malformed or hostile input | zod schemas on every tool input and request body (`strict`, bounded sizes); invalid input becomes a tool error, not a state change |
| Snapshot ↔ selection | Stale recommendations | Versioned snapshots; selection and recovery always revalidate against the latest version |

## Preview vs repository/backend
| | Single-file web preview | Repository (`npm start`) |
|---|---|---|
| Where the core runs | In the page | In the Node server |
| Model access | The viewer's own account via the host page's `sample` capability, when allowed; otherwise deterministic | `ANTHROPIC_API_KEY` in the server environment; otherwise deterministic |
| Session isolation | Page memory of one viewer | HttpOnly cookie sessions, rate limits, server-side state |
| Deployment | Hosted artifact page | Not deployed by this project; runs locally |

## Front end
- `web/cabin3d.js`: aircraft and cabin (instanced seats, lofted airfoil wings and tail, lathe-turned engines, cutaway with frame stubs), the camera path between the seat map and the seat, the Seated / Window / Legroom presets and Reset view, framing that fits the aircraft beside the panel, and a seat-part registry so one seat's back and the tray ahead can move.
- `web/explore.js`: "Explore this seat": window shade, tray table, reading light and the recline preview, which measures the modelled change in knee space behind.
- `web/scenery.js` (loaded after the first frame): sky dome, procedural cloud layers and ground for one daytime preset that also drives the cabin lighting. Separate render pass with its own far plane.
- `web/ui.js`: the seat pass (two advantages and one trade-off from the seat data, Seat details), the adviser, the two-seat comparison, the seat chart and the About dialog.
- `web/flat.js`: fallback when WebGL is unavailable or the 3D library fails to load (seat chart and adviser still work).

## Fit summary
`src/core/explain.ts` builds a `fit` object for every card: what the passenger asked for (requirements first, then preferences), which of those the group meets, which it misses, and one trade-off. The interface turns it into "You asked for … This seat matches both. The trade-off is …". It is computed from the trip state and the seat data in both modes, so a live model's wording can't change it.

## Preview deployment (single-file page)
The single-file preview bundles the same core, tools and UI into the page. When the viewer allows it, the model is reached through the host page's `sample` capability **on the viewer's own account**: there is still no key in the page, and tools run in the page with the same validation. Token counts aren't exposed there, so the trace shows latency only. Otherwise the preview uses the deterministic planner and says so.
