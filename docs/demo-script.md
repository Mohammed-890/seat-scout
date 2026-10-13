# Three-minute demo script

**0:00 – Setup (15 s).** “Seat Scout is an independent prototype. The data is synthetic: an illustrative cabin, sample prices and generated availability. The point is how the agent makes decisions you can verify.” Point at the mode pill (Live / Deterministic).

**0:15 – The request (40 s).** Paste:
> We're two adults travelling with a five-year-old. Our total seat budget is £45. We want to sit together, and I'd prefer a window away from the wing.

Show the three groups lit up in the aircraft and the cards. Open “Why” on the first card: each statement is tagged **Fact / Calculated / Preference / Estimate**. Point out that the total is calculated by code from the seat prices.

**0:55 – Why these seats? (40 s).** Open **Engineering**. Walk down the trace:
- **Constraints vs preferences:** budget, together and the demo exit-row rule are hard; window and wing view are preferences.
- **findAdjacentSeatGroups:** 60 candidate groups, with each exclusion reason counted (unavailable, over budget, exit row with a child). Click *Show seats* to light up the excluded ones in red.
- **Scores:** the named components (window +6, clear view +4, price −1.6).
- **Final validation** against snapshot v1.

**1:35 – Change of plan (30 s).** Type “Actually, £25 maximum.” Show that only `budget.totalGBP` changed in the trace and the preferences are untouched. Then “Why not row 6?”: the exact reasons per group (taken seats, £66 > £25).

**2:05 – Failure recovery (40 s).** Demo controls:
- **Seat becomes unavailable:** snapshot v1 → v2, the old recommendation is revalidated and found invalid, and the system re-plans with unchanged preferences.
- **Impossible budget:** “Nothing satisfies…”, with the relaxation options and their counts; it never splits the party or overspends.
- **Tool timeout:** the trace shows the timeout, one retry and success.

**2:45 – Evidence (15 s).** **Explore the engineering → Evaluation:** 47 predefined cases, checked against the raw data rather than the engine. Deterministic pipeline 45/47 vs the naive baseline 9/47; the two failures are explained, not hidden. The live-model evaluation hasn't been run yet, and I say so.
