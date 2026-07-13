/**
 * A zeroed OS image carrying just the vector shape `detectOsVectors`
 * recognizes: a JMP at each well-known row (all pointing at one RTS stub)
 * and a KEYBDV get-byte entry. For tests that need the machine's built-in
 * OS-level traps (SIO, paste) wired up without booting a real OS.
 */
export function recognizableOs(size: 10240 | 16384): Uint8Array {
	const os = new Uint8Array(size);
	const base = size === 16384 ? 0xc000 : 0xd800;
	const put = (address: number, ...bytes: number[]) =>
		os.set(bytes, address - base);

	put(0xe424, 0xff, 0xe5); // KEYBDV get-byte entry (stored -1) -> $E600
	put(0xe459, 0x4c, 0x00, 0xe5); // SIOV
	put(0xe46e, 0x4c, 0x00, 0xe5); // CIOINV
	put(0xe474, 0x4c, 0x00, 0xe5); // WARMSV
	put(0xe477, 0x4c, 0x00, 0xe5); // COLDSV
	put(0xe500, 0x60); // the shared target: RTS
	put(0xe600, 0xad, 0xfc, 0x02, 0x60); // K: get-byte stub: LDA CH, RTS
	return os;
}
