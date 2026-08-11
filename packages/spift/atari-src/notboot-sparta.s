; The boot record spift writes when a disk gets a SpartaDOS filesystem but
; no DOS - the sibling of notboot.s with the SpartaDOS record shape.
;
; A SpartaDOS boot record is identified by the JMP at offset 6: the OS
; loads three sectors at $3000 and calls $3006, and the JMP there targets
; $3080 - the first byte of the second boot sector - clearing the parameter
; block and whatever else sector 1 holds. SDX's own FORMAT leaves a loader
; that prints "Error: No DOS"; this stands in for it, saying what the disk
; is and waiting for RESET.
;
; Bytes $09-$2A are the SpartaDOS parameter block (directory pointer,
; totals, bitmap location, allocation hints, volume identity); spift's
; formatter overwrites them after laying this record down, so they are
; zeros here.

LOAD = $3000
ENTRY = LOAD + $80
; Zero page pointer to the top-left of the screen, set up by the OS long
; before it boots anything.
SAVMSC = $58
; The screen holds internal codes, not ATASCII: for the printable range
; $20-$5F the two differ by exactly this.
SCREEN_CODE_BIAS = $20

.segment "OUTPUT"
.org LOAD

	; Disk boot header: three 128-byte boot sectors, the SpartaDOS
	; customary load address, and the init vector the OS copies to
	; DOSINI.
	.byte 0				; boot flags
	.byte 3				; number of boot sectors
	.word LOAD			; load address
	.word init			; DOSINI address

	; The signature everything keys on: JMP $3080. Only the target's low
	; byte is stable across real DOS builds (BW-DOS loads at $0800), so
	; detectors check exactly that; keeping the canonical SpartaDOS
	; target makes this record read as what it is.
	jmp start

	; $09-$2A: the parameter block, filled in by the formatter.
	.res $2b - $09

	; The rest of sector 1 carries the message: exactly two 40-column
	; rows, so the copy loop needs no terminator, and ending flush at
	; $307B leaves five spare bytes before the entry point.
message:
	.byte "THIS DISK HAS A FILE SYSTEM BUT NO DOS. "
	.byte "PRESS RESET.                            "
message_length = * - message
	.res ENTRY - *

	; Sector 2, where the JMP lands. Two lines of text straight into
	; screen memory, as notboot.s does and for the same reasons.
start:
	ldy #message_length - 1
copy:
	lda message,y
	sec
	sbc #SCREEN_CODE_BIAS
	sta (SAVMSC),y
	dey
	bpl copy

	; Nothing left to do. RESET from here cold-starts, which re-reads the
	; disk - so if the user has meanwhile written a DOS to it, it boots.
wait:
	jmp wait

	; Never reached: the continuation above does not return, so the OS
	; never finishes booting and never calls DOSINI. Here so the vector
	; points at something harmless.
init:
	rts

	; Pad to the full three-sector boot area.
	.res LOAD + 3 * 128 - *
