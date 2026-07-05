// Analog 2-axis position → digital 8-way, shared by the gamepad poller and the
// OSD touch stick. The pair is read radially, not per-axis: below the engage
// radius (a circular deadzone) it's centred; past it the angle snaps to one of
// 8 octants. Radial magnitude reaches 1 in every direction, so diagonals are as
// reachable as cardinals (unlike a per-axis threshold, which a round gate caps
// near 0.707 and leaves a dead wedge on every diagonal). Hysteresis stops
// chatter: a lower release radius, and an angular margin before an engaged
// stick jumps to a neighbouring octant. The thresholds are the caller's — a
// spring-centred thumbstick and a thumb on glass want different tuning.

const QUARTER_PI = Math.PI / 4;
const EIGHTH_PI = Math.PI / 8;
const TWO_PI = Math.PI * 2;

/** The caller-tuned thresholds (see the module comment). */
export interface RadialStickConfig {
	/** Radius where a centred stick engages. */
	engage: number;
	/** Radius an engaged stick must drop below to re-centre (< engage). */
	release: number;
	/** Radians past the 22.5° octant boundary before an engaged stick switches. */
	sectorMargin: number;
}

/** Per-stick hysteresis state: whether it's currently engaged, and its last
 *  octant (−1 = none). Persist one per stick across reads. */
export interface RadialStickState {
	engaged: boolean;
	octant: number;
}

export function initialStickState(): RadialStickState {
	return { engaged: false, octant: -1 };
}

/**
 * Read one stick sample. `x`/`y` are the position in −1..1 space (+y = down,
 * matching both gamepad axes and screen coordinates). Updates `state` in place
 * and returns the octant — 0 = +x, counting towards +y (so 1 = down-right on
 * screen), or −1 for centred.
 */
export function readRadialStick(
	x: number,
	y: number,
	state: RadialStickState,
	config: RadialStickConfig,
): number {
	const r = Math.hypot(x, y);
	state.engaged = state.engaged ? r > config.release : r >= config.engage;
	if (!state.engaged) {
		state.octant = -1;
		return -1;
	}
	const angle = Math.atan2(y, x);
	let k = ((Math.round(angle / QUARTER_PI) % 8) + 8) % 8;
	// Boundary hysteresis: hold the last octant until clearly into the next.
	if (state.octant >= 0 && k !== state.octant) {
		let d = Math.abs(angle - state.octant * QUARTER_PI);
		if (d > Math.PI) d = TWO_PI - d;
		if (d < EIGHTH_PI + config.sectorMargin) k = state.octant;
	}
	state.octant = k;
	return k;
}
