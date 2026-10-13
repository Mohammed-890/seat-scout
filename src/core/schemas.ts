import { z } from "zod";

/* ---------- canonical data (validated when loaded) ---------- */
export const Position = z.enum(["window", "middle", "aisle"]);
export type Position = z.infer<typeof Position>;
export const Zone = z.enum(["front", "middle", "rear"]);
export type Zone = z.infer<typeof Zone>;

export const RowConfig = z.object({
  row: z.number().int().min(1),
  pitchIn: z.number().positive(),
  exitRow: z.boolean(),
  bulkhead: z.boolean(),
  recline: z.enum(["full", "limited"]),
  windowView: z.enum(["clear", "wing", "partial_wing"]),
  noiseEstimate: z.enum(["quiet", "engine_hum", "busy"]),
  nearToilets: z.boolean(),
  underSeatStorage: z.boolean(),
  zone: Zone,
});
export type RowConfig = z.infer<typeof RowConfig>;

export const SeatConfig = z.object({
  id: z.string().regex(/^\d{1,2}[A-F]$/),
  row: z.number().int(),
  letter: z.enum(["A", "B", "C", "D", "E", "F"]),
  position: Position,
  block: z.enum(["left", "right"]),
  priceGBP: z.number().min(0),
});

export const ProvenanceStatus = z.enum(["synthetic", "estimated", "calculated", "policy", "verified"]);
export type ProvenanceStatus = z.infer<typeof ProvenanceStatus>;

export const CabinConfig = z.object({
  configId: z.string(),
  label: z.string(),
  provenance: z.record(z.object({ status: ProvenanceStatus, note: z.string(), currency: z.string().optional() })),
  generator: z.string(),
  geometry: z.object({
    inchesToMeters: z.number(),
    aisleWidthM: z.number(),
    seatWidthM: z.number(),
    windowPitchM: z.number(),
    fuselageRadiusM: z.number(),
  }),
  rows: z.array(RowConfig),
  seats: z.array(SeatConfig),
  passengerTips: z.record(z.string()),
});
export type CabinConfig = z.infer<typeof CabinConfig>;

export const Policy = z.object({
  policyId: z.string(),
  status: z.literal("demo"),
  note: z.string(),
  exitRow: z.object({ minAge: z.number(), allowInfants: z.boolean(), allowChildren: z.boolean() }),
  childrenMustSitWithAdult: z.boolean(),
  maxGroupSize: z.number().int().min(1),
});
export type Policy = z.infer<typeof Policy>;

export const Snapshot = z.object({
  version: z.number().int().min(1),
  createdAt: z.string(),
  source: z.string(),
  takenSeats: z.array(z.string()),
  note: z.string().optional(),
});
export type Snapshot = z.infer<typeof Snapshot>;

/* ---------- structured trip state (persisted separately from the conversation) ---------- */
export const Traveller = z.object({
  type: z.enum(["adult", "child", "infant"]),
  age: z.number().int().min(0).max(120).optional(),
});
export type Traveller = z.infer<typeof Traveller>;

const Weight = z.number().min(0).max(2);
export const Preferences = z.object({
  window: Weight.default(0),
  aisle: Weight.default(0),
  clearView: Weight.default(0),
  legroom: Weight.default(0),
  quiet: Weight.default(0),
  front: Weight.default(0),
  cheap: Weight.default(0),
});
export type Preferences = z.infer<typeof Preferences>;

export const HardConstraints = z.object({
  position: Position.nullable().default(null), // at least one seat in the group has this position
  zone: Zone.nullable().default(null),
  fullRecline: z.boolean().default(false),
  underSeatBag: z.boolean().default(false),
  avoidToilets: z.boolean().default(false),
  clearViewRequired: z.boolean().default(false),
  exitRowOnly: z.boolean().default(false),
});
export type HardConstraints = z.infer<typeof HardConstraints>;

export const TripState = z.object({
  revision: z.number().int().min(0),
  travellers: z.array(Traveller),
  budget: z.object({ totalGBP: z.number().min(0).nullable(), perSeatGBP: z.number().min(0).nullable() }),
  together: z.boolean(),
  hard: HardConstraints,
  prefs: Preferences,
  heightCm: z.number().min(120).max(230).nullable(),
  excludedSeats: z.array(z.string()),
  lastRecommendation: z.object({ groups: z.array(z.array(z.string())), snapshotVersion: z.number() }).nullable(),
  selection: z.object({ seats: z.array(z.string()), snapshotVersion: z.number() }).nullable(),
});
export type TripState = z.infer<typeof TripState>;

/** A patch updates only the fields it names. Used by the model tool and the rule-based parser alike. */
export const StatePatch = z
  .object({
    setTravellers: z.array(Traveller).max(9).optional(),
    addTravellers: z.array(Traveller).max(9).optional(),
    removeTravellers: z.object({ type: z.enum(["adult", "child", "infant", "any"]), count: z.number().int().min(1).max(9) }).optional(),
    budgetTotalGBP: z.number().min(0).max(5000).nullable().optional(),
    budgetPerSeatGBP: z.number().min(0).max(5000).nullable().optional(),
    together: z.boolean().optional(),
    hard: HardConstraints.partial().optional(),
    prefs: Preferences.partial().optional(),
    heightCm: z.number().min(120).max(230).nullable().optional(),
    excludeSeats: z.array(z.string().regex(/^\d{1,2}[A-F]$/)).max(20).optional(),
  })
  .strict();
export type StatePatch = z.infer<typeof StatePatch>;

export const SeatId = z.string().transform((s) => s.trim().toUpperCase()).pipe(z.string().regex(/^\d{1,2}[A-F]$/, "seat ids look like 14A"));
export const SeatGroup = z.array(SeatId).min(1).max(3);
