// Converts an 8x8 character bitmap into closed rectilinear contours by
// tracing the boundary between filled and empty pixels. Coordinates are in
// pixel-grid units: x grows right, y grows DOWN (screen order), vertices are
// lattice points 0-8. The y flip into font coordinates happens in the caller.
//
// Edges are emitted so that the filled area lies to the RIGHT of the walking
// direction (in this y-down system). Holes automatically come out with the
// opposite orientation, which is all the TrueType non-zero winding fill rule
// needs. Where two diagonal pixels touch at a corner, the sharper right turn
// is preferred so each pixel gets its own contour instead of a bowtie.

export interface GridPoint {
	x: number;
	y: number;
}

interface Edge {
	fx: number;
	fy: number;
	tx: number;
	ty: number;
	used: boolean;
}

const vertexId = (x: number, y: number) => y * 9 + x;

export function traceBitmap(bitmap: Uint8Array): GridPoint[][] {
	if (bitmap.length !== 8) throw new Error("bitmap must be 8 bytes");

	const filled = (r: number, c: number) =>
		r >= 0 && r < 8 && c >= 0 && c < 8 && ((bitmap[r]! >> (7 - c)) & 1) !== 0;

	const edges: Edge[] = [];
	const byStart = new Map<number, Edge[]>();
	const add = (fx: number, fy: number, tx: number, ty: number) => {
		const edge = { fx, fy, tx, ty, used: false };
		edges.push(edge);
		const id = vertexId(fx, fy);
		const list = byStart.get(id);
		if (list) list.push(edge);
		else byStart.set(id, [edge]);
	};

	for (let r = 0; r < 8; r++) {
		for (let c = 0; c < 8; c++) {
			if (!filled(r, c)) continue;
			if (!filled(r - 1, c)) add(c, r, c + 1, r); // top side, walk right
			if (!filled(r + 1, c)) add(c + 1, r + 1, c, r + 1); // bottom, walk left
			if (!filled(r, c - 1)) add(c, r + 1, c, r); // left side, walk up
			if (!filled(r, c + 1)) add(c + 1, r, c + 1, r + 1); // right side, walk down
		}
	}

	const contours: GridPoint[][] = [];
	for (const first of edges) {
		if (first.used) continue;
		const points: GridPoint[] = [];
		let edge = first;
		for (;;) {
			edge.used = true;
			points.push({ x: edge.fx, y: edge.fy });
			if (edge.tx === first.fx && edge.ty === first.fy) break;
			const candidates = byStart
				.get(vertexId(edge.tx, edge.ty))!
				.filter((e) => !e.used);
			let next = candidates[0]!;
			if (candidates.length > 1) {
				// Corner where two diagonal pixels touch: prefer the sharper
				// right turn (positive cross product in y-down coordinates).
				const dx = edge.tx - edge.fx;
				const dy = edge.ty - edge.fy;
				for (const candidate of candidates.slice(1)) {
					const cross =
						dx * (candidate.ty - candidate.fy) -
						dy * (candidate.tx - candidate.fx);
					const bestCross = dx * (next.ty - next.fy) - dy * (next.tx - next.fx);
					if (cross > bestCross) next = candidate;
				}
			}
			edge = next;
		}
		contours.push(simplify(points));
	}

	return contours;
}

// Drops points in the middle of straight runs (the tracer emits unit-length
// edges, so every intermediate lattice point starts out present).
function simplify(points: GridPoint[]): GridPoint[] {
	const result: GridPoint[] = [];
	for (let i = 0; i < points.length; i++) {
		const prev = points[(i + points.length - 1) % points.length]!;
		const cur = points[i]!;
		const next = points[(i + 1) % points.length]!;
		const straight =
			(prev.x === cur.x && cur.x === next.x) ||
			(prev.y === cur.y && cur.y === next.y);
		if (!straight) result.push(cur);
	}
	return result;
}
