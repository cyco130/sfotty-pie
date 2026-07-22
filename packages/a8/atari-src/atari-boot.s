; Atari disk-boot output format: a three-sector single-density boot image.
;
; `output_atari_boot init, load` scripts the whole image: the 6-byte disk
; boot header at `load`, then the CODE/RODATA/DATA segments. The OS loads
; the sectors at `load` and calls `init` through DOSINI. The boot
; continuation entry is at load+6 - the image's first byte after the header
; - so programs put their continuation stub at the top of CODE. Padding to
; the full 384 bytes is the build script's job (in-assembler padding waits
; on render-time `.res`).

.export .macro output_atari_boot init, load
	.define_segment "CODE"
	.define_segment "RODATA"
	.define_segment "DATA"

	.segment "OUTPUT"
	.org load

		; Disk boot header
		.byte 0			; flags
		.byte 3			; number of boot sectors
		.word load		; load address
		.word init		; init address (goes to DOSINI)

		.emit "CODE"
		.emit "RODATA"
		.emit "DATA"
.endmacro
