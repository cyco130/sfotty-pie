; Atari XEX (binary load) output format - a single load chunk plus a RUNAD
; trailer.
;
; `output_xex start, load` scripts the whole file: the $FFFF binary-load
; signature, one chunk covering CODE+RODATA+DATA at `load`, then a RUNAD
; chunk so DOS (or the XEX boot loader) jumps to `start`. ZEROPAGE is
; reserved at $80 (free from the OS) and BSS just past the loaded image;
; neither occupies file bytes.
;
; Copied from a8apps/ragtime-snake/src/xex.s - the second copy in the repo,
; so this wants lifting into a shared package along with src/lib/atari/.
; Both of its hardcoded choices are written for a game and are probably
; wrong for a DOS: $80 is only "free from the OS" for a program that owns
; the machine, and a DOS is what other programs' zero page has to survive.

.export .macro output_xex start, load, .out dos_end
	.define_segment "CODE"
	.define_segment "RODATA"
	.define_segment "DATA"
	.define_segment "INIT"
	.define_segment "BSS"
	.define_segment "ZEROPAGE"

	.segment "OUTPUT"
		; Binary-load signature and the chunk's inclusive address range
		.word $FFFF
		.word load
		.word load_end - 1

	; Zero page workspace
	.org $80
		.emplace "ZEROPAGE"
	.if * > $100
	.error "Zero page overflow"
	.endif

	; The load chunk
	.org load
		.emit "CODE"
		.emit "RODATA"
		.emit "DATA"
	init_start:
		.emit "INIT"
		check_ram_end
	load_end:
	.org init_start ; Overlay BSS on top of INIT
		.emplace "BSS"
		check_ram_end
	dos_end:

		; RUNAD chunk: run the program at `start`
		.word $02E0, $02E1
		.word start
.endmacro

.macro check_ram_end
	.if * > $C000
		.error "Memory overflow (image extends past $C000)"
	.endif
.endmacro
