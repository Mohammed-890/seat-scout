# Three-minute demo script

**0:00 – Try the seat (35 s).** "Seat Scout is an independent prototype with synthetic data: an illustrative cabin, sample prices and generated availability." Click **14A**: the seat lights up in the aircraft, then the camera flies to the seated eye position. Press **T** (tray), **S** (shade), **B** (seatbelt). Open **Scene → Sunset**: the outside and the cabin light change together. Press **R** for the recline preview: the camera steps into the aisle behind and shows how much space the passenger behind loses, measured in the model.

**0:35 – Getting out (20 s).** Press **G**. Two passengers between 14A and the aisle stand and step out, because 29 in pitch is too tight to pass seated passengers. The panel counts people, trays and pitch, and says it is an illustration, not a timing or accessibility measure.

**0:55 – The request (30 s).** Back to the aircraft. Paste:
> We're two adults travelling with a five-year-old. Our total seat budget is £45. We want to sit together, and I'd prefer a window away from the wing.

The progress lines come from real execution events. Three options light up; each card separates per-seat prices from the group total, and offers scene actions (View these seats, Compare the alternative, Show the window view, Try getting out, Preview the available space).

**1:25 – Why these seats? (35 s).** Engineering: constraints vs preferences, `findAdjacentSeatGroups` with exclusion reasons (counts overlap, because one group can fail several rules), ranking components (relative points, not comfort probabilities), and final validation against snapshot v1.

**2:00 – Change of plan and failures (35 s).** "Actually, £25 maximum." (only the budget changes), "Why not row 6?", "I care more about getting out easily." (aisle access now outranks the window). Demo controls: seat taken → snapshot v2 and revalidation; impossible budget → conflict explained, nothing split or overspent; tool timeout → one retry.

**2:35 – Evidence (25 s).** Explore the engineering → Deterministic eval: 47 cases checked against the raw data. Show the four metrics with numerators and denominators, and the note on why an earlier run showed "100% hard constraints" while two cases failed. Live-model eval: not run, and the app says so.
