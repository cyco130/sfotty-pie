; Atari disk-boot output format: a three-sector single-density boot image.
;
; `output_atari_boot init, load, sectors` scripts the whole image: the
; 6-byte disk boot header at `load`, then the CODE/RODATA/DATA segments,
; padded to the next sector boundary - the header's sector count is
; computed from the padded size, so the image is always exactly as many
; sectors as its content needs. The computed count is also published as a
; constant under the caller-supplied `sectors` name, so loaders can derive
; their buffer address and first payload sector from it. The OS loads the
; sectors at `load` and calls `init` through DOSINI.
; The boot continuation entry is at load+6 - the image's first byte after
; the header - so programs put their continuation stub at the top of CODE.

.export .macro output_atari_boot init, load, .out sectors
	.define_segment "CODE"
	.define_segment "RODATA"
	.define_segment "DATA"

	.segment "OUTPUT"
	.org load

		; Disk boot header
		.byte 0			; flags
		.byte sectors	; number of boot sectors
		.word load		; load address
		.word init		; init address (goes to DOSINI)

		.emit "CODE"
		.emit "RODATA"
		.emit "DATA"

		; Pad the image to the next sector boundary
		.res (128 - (* - load) % 128) % 128
boot_end:

	; The image's sector count, published under the caller-supplied name
	sectors = (boot_end - load) / 128
.endmacro
