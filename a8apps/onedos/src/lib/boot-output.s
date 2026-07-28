.export .macro output_atari_boot load_address, init, run
	.define_segment "BOOT_PARAMS"
	.define_segment "CODE"
	.define_segment "RODATA"
	.define_segment "DATA"
	.define_segment "BSS"
	.define_segment "ZEROPAGE"

	; A boot image is always the standard three sectors: the header tells the
	; OS how many to read and the pad below makes the image that long, so the
	; two are one definition rather than two numbers that can disagree.
	; Overrunning it is caught by the pad going negative.
	BOOT_SECTORS = 3

	.segment "OUTPUT"

	.org load_address
		; Disk boot header
		.byte 0            ; flags
		.byte BOOT_SECTORS ; number of boot sectors
		.word load_address ; load address
		.word init         ; init address (goes to DOSINI)

		jmp run
		.emit "BOOT_PARAMS"

		.emit "CODE"
		.emit "RODATA"
		.emit "DATA"
	load_end:

		; Pad the image out to the full three sectors
		.res load_address + BOOT_SECTORS * 128 - *

	.org load_end
		.emplace "BSS"

	.org $43 ; FMSZPG, 7 bytes
		.emplace "ZEROPAGE"
		.if * > $49
			.error "ZEROPAGE segment is too long"
		.endif
.endmacro
