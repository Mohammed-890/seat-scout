/**
 * The canonical dataset. Cabin geometry, seat map, tools, comparisons and cards all read from here.
 * Every attribute carries provenance so explanations can say what is a fact in the (synthetic) data,
 * what is calculated, and what is only an estimate.
 */
import { CabinConfig, Policy, Snapshot, type ProvenanceStatus, type Position, type Zone } from "./schemas.js";
import { buildGeometry, windowAlignment, KNEE_RATIO, type CabinGeometry, type WindowAlignment } from "./geometry.js";

export interface Fact<T> { value: T; status: ProvenanceStatus; source: string }

export interface Seat {
  id: string; row: number; letter: string; position: Position; block: "left" | "right";
  priceGBP: number; pitchIn: number; exitRow: boolean; bulkhead: boolean; recline: "full" | "limited";
  windowView: "clear" | "wing" | "partial_wing" | null; noiseEstimate: "quiet" | "engine_hum" | "busy";
  nearToilets: boolean; underSeatStorage: boolean; zone: Zone;
  kneeSpaceCm: number; windowAlignment: WindowAlignment | null; seatsToPassForAisle: 0 | 1 | 2;
  /** Untrusted user-generated text. Never treated as instructions. */
  passengerTip: string | null;
}

export interface Dataset {
  config: CabinConfig;
  policy: Policy;
  geometry: CabinGeometry;
  seats: Map<string, Seat>;
  seatList: Seat[];
  facts(seat: Seat): Record<string, Fact<unknown>>;
  clearanceCm(seat: Seat, heightCm: number): number;
}

export function createDataset(rawConfig: unknown, rawPolicy: unknown): Dataset {
  const config = CabinConfig.parse(rawConfig);
  const policy = Policy.parse(rawPolicy);
  const geometry = buildGeometry(config);
  const rows = new Map(config.rows.map((r) => [r.row, r]));
  const seats = new Map<string, Seat>();
  for (const s of config.seats) {
    const r = rows.get(s.row);
    if (!r) throw new Error(`seat ${s.id} has no row config`);
    seats.set(s.id, {
      id: s.id, row: s.row, letter: s.letter, position: s.position, block: s.block, priceGBP: s.priceGBP,
      pitchIn: r.pitchIn, exitRow: r.exitRow, bulkhead: r.bulkhead, recline: r.recline,
      windowView: s.position === "window" ? r.windowView : null, noiseEstimate: r.noiseEstimate,
      nearToilets: r.nearToilets, underSeatStorage: r.underSeatStorage, zone: r.zone,
      kneeSpaceCm: Math.round(geometry.kneeSpace(s.row).meters * 100),
      windowAlignment: s.position === "window" ? windowAlignment(geometry, s.row) : null,
      seatsToPassForAisle: s.position === "aisle" ? 0 : s.position === "middle" ? 1 : 2,
      passengerTip: config.passengerTips[s.id] ?? null,
    });
  }
  const P = config.provenance;
  const src = config.configId;
  const facts = (seat: Seat): Record<string, Fact<unknown>> => ({
    position: { value: seat.position, status: P.layout.status, source: src },
    priceGBP: { value: seat.priceGBP, status: P.prices.status, source: src },
    pitchIn: { value: seat.pitchIn, status: P.layout.status, source: src },
    exitRow: { value: seat.exitRow, status: P.layout.status, source: src },
    recline: { value: seat.recline, status: P.layout.status, source: src },
    windowView: { value: seat.windowView, status: P.layout.status, source: src },
    underSeatStorage: { value: seat.underSeatStorage, status: P.layout.status, source: src },
    nearToilets: { value: seat.nearToilets, status: P.layout.status, source: src },
    kneeSpaceCm: { value: seat.kneeSpaceCm, status: P.kneeSpace.status, source: "3D cabin geometry" },
    windowAlignment: { value: seat.windowAlignment, status: P.windowAlignment.status, source: "3D cabin geometry" },
    noise: { value: seat.noiseEstimate, status: P.noise.status, source: src },
    seatsToPassForAisle: { value: seat.seatsToPassForAisle, status: "calculated", source: "seat position" },
  });
  return {
    config, policy, geometry, seats, seatList: [...seats.values()], facts,
    clearanceCm: (seat, h) => Math.round(seat.kneeSpaceCm - KNEE_RATIO * h),
  };
}

/** Versioned availability snapshots. Each session gets its own store so demo controls never leak between users. */
export class AvailabilityStore {
  private snapshots: Snapshot[];
  constructor(initial: unknown) { this.snapshots = [Snapshot.parse(initial)]; }
  get latest(): Snapshot { return this.snapshots[this.snapshots.length - 1]; }
  get version(): number { return this.latest.version; }
  isFree(seatId: string, version = this.version): boolean {
    const s = this.snapshots.find((x) => x.version === version) ?? this.latest;
    return !s.takenSeats.includes(seatId);
  }
  takenSet(): Set<string> { return new Set(this.latest.takenSeats); }
  /** Creates a new snapshot version; old versions are kept for audit/trace. */
  markTaken(seatIds: string[], note: string): Snapshot {
    const next: Snapshot = {
      version: this.version + 1, createdAt: new Date().toISOString(), source: "demo-control",
      takenSeats: [...new Set([...this.latest.takenSeats, ...seatIds])], note,
    };
    this.snapshots.push(Snapshot.parse(next));
    return next;
  }
}
