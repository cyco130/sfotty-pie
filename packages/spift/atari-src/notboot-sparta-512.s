; notboot-sparta.s for 512-byte-sector media: one full-size boot sector,
; loaded at $0400 with the JMP at offset 6 targeting $0440 - the signature
; that marks a 512-byte SpartaDOS disk. The parameter block is the same
; and the formatter fills it the same way.
;
; In practice these images are hard-disk partitions reached through an SDX
; driver rather than OS-booted, so this code is mostly a correct-shaped
; placeholder; it still prints and waits if something does boot it.

LOAD = $0400
ENTRY = LOAD + $40
SAVMSC = $58
SCREEN_CODE_BIAS = $20

.segment "OUTPUT"
.org LOAD

	.byte 0				; boot flags
	.byte 1				; number of boot sectors
	.word LOAD			; load address
	.word init			; DOSINI address
	jmp start			; the $0440 signature

	; $09-$2A: the parameter block, filled in by the formatter.
	.res $2b - $09

	; Only 21 bytes sit between the parameter block and the entry point -
	; not enough for the message, which therefore lives after the code.
	.res ENTRY - *

start:
	ldy #message_length - 1
copy:
	lda message,y
	sec
	sbc #SCREEN_CODE_BIAS
	sta (SAVMSC),y
	dey
	bpl copy

wait:
	jmp wait

init:
	rts

message:
	.byte "THIS DISK HAS A FILE SYSTEM BUT NO DOS. "
	.byte "PRESS RESET.                            "
message_length = * - message

	; Pad to the full sector.
	.res LOAD + 512 - *
