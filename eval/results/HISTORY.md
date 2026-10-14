# Evaluation history

Runs 1–3 were executed on 2026-10-13 against `eval/cases.json` v1 (47 cases), whose expectations were written before the first run. On 2026-10-14 the cases were *strengthened* (an explicit `requires` field on 12 cases stating what the passenger asked for); no expectation was removed or loosened.

| Run | Deterministic pipeline | Naive baseline | What changed before the run |
|---|---|---|---|
| 1 (`2026-10-13-deterministic-run1.json`) | 39/47 | 9/47 | First run. |
| 2 | 44/47 | 9/47 | Fixed bugs the eval exposed: “must not be over the wing” wasn't parsed; “Cheaper.” lowered the budget below every feasible option instead of saying the current pick is already the cheapest; “Our family needs seats” didn't ask for party size; help text contained an unsupported example price. |
| 3 (`latest.json`) | 45/47 | 9/47 | A turn that asks a question without changing the options is now classified as `clarify`, not `recommend`. |

| 4 (`2026-10-14-deterministic-before-parser-fix.json`) | 40/47 | 7/47 | Measurement only: the run-3 parser re-run against strengthened cases and split metrics. Request understanding 20/27, parsed-constraint satisfaction 101/101, actual-requirement satisfaction 95/101, impossible recognised 4/6. |
| 5 (`latest.json`) | 47/47 | 9/47 | Parser fix: a named seat position (“window”, “مقعد شباك”) is a requirement unless its clause softens it. Understanding 27/27, actual-requirement satisfaction 95/95, impossible recognised 6/6. |

## Why “100% hard constraints” coexisted with the two failures (runs 1–3)
The old metric divided *shown groups that met the expected constraints* by *shown groups*. `nofeas-05` and `ar-03` only asserted “no groups”, so they declared no window requirement for the shown groups to fail against, and the parser had stored the window as a preference. Every shown group met every constraint the system knew about. The error was in **request understanding**, which was not measured. The suite now reports four separate figures, each with numerator and denominator: request understanding, parsed-constraint satisfaction, actual-requirement satisfaction and impossible-request recognition.

## Live-model evaluation
Not run: no `ANTHROPIC_API_KEY` was available. `npm run eval:live` runs the tool-grounded agent and a no-tools baseline with the same model and settings, and writes `results/<date>-live.json`. No live numbers are claimed anywhere in this repository.
