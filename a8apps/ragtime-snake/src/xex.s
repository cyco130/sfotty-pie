; Atari XEX (binary load) output format - a single load chunk plus a RUNAD
; trailer.
;
; `output_xex start, load` scripts the whole file: the $FFFF binary-load
; signature, one chunk covering CODE+RODATA+DATA at `load`, then a RUNAD
; chunk so DOS (or the XEX boot loader) jumps to `start`. ZEROPAGE is
; reserved at $80 (free from the OS) and BSS just past the loaded image;
; neither occupies file bytes.

.export .macro output_xex start, load
	.define_segment "CODE"
	.define_segment "RODATA"
	.define_segment "DATA"
	.define_segment "BSS"
	.define_segment "ZEROPAGE"

	.segment "OUTPUT"
		; Binary-load signature and the chunk's inclusive address range
		.word $FFFF
		.word load
		.word chunk_end - 1

	; Zero page workspace
	.org $80
		.emplace "ZEROPAGE"

	; The load chunk
	.org load
		.emit "CODE"
		.emit "RODATA"
		.emit "DATA"
chunk_end:
		.emplace "BSS"

		; RUNAD chunk: run the program at `start`
		.word $02E0, $02E1
		.word start
.endmacro
