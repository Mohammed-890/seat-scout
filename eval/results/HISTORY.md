# Evaluation history

All runs below were executed on 2026-10-13 against `eval/cases.json` v1 (47 cases). Case expectations were written before the first run and were not edited afterwards.

| Run | Deterministic pipeline | Naive baseline | What changed before the run |
|---|---|---|---|
| 1 (`2026-10-13-deterministic-run1.json`) | 39/47 | 9/47 | First run. |
| 2 | 44/47 | 9/47 | Fixed bugs the eval exposed: “must not be over the wing” wasn't parsed; “Cheaper.” lowered the budget below every feasible option instead of saying the current pick is already the cheapest; “Our family needs seats” didn't ask for party size; help text contained an unsupported example price. |
| 3 (`latest.json`) | 45/47 | 9/47 | A turn that asks a question without changing the options is now classified as `clarify`, not `recommend`. |

## Remaining failures (kept on purpose)
- `nofeas-05` (“1 adult, window, total £2”) and `ar-03` (Arabic: “alone, window seat, budget £3”): the cases expect “no feasible option”, because they treat a bare “window” as a must-have. The parser treats a window without words like “need” or “must” as a preference: it keeps the budget and recommends a free middle seat, flagging “no window seat” as a compromise. That is a product decision, not a constraint violation; I have left the expectation as written, so it is reported as a failure.

## Live-model evaluation
Not run: no `ANTHROPIC_API_KEY` was available. `npm run eval:live` runs the tool-grounded agent and a no-tools baseline with the same model and settings, and writes `results/<date>-live.json`. No live numbers are claimed anywhere in this repository.
