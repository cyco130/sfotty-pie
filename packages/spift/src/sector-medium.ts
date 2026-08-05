// The neutral seam between containers and filesystems: 1-based linear
// sectors, full stop. Families whose native addressing differs map on top.

export interface SectorMedium {
	/** Nominal - readSector returns the actual per-sector length. */
	readonly sectorSize: number;
	readonly sectorCount: number;
	/** 1-based; null when the sector is out of range. */
	readSector(sector: number): Uint8Array | null;
}
