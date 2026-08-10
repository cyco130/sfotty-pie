; The boot record spift writes when a disk gets a filesystem but no DOS.
;
; A real DOS's FORMAT leaves its own loader on the disk with byte 14 set to
; zero, which is the "not bootable" marker its boot code checks first. We
; cannot ship Atari's loader, so this stands in: it says what the disk is
; and then waits, and RESET cold-starts the machine.
;
; Byte 14 stays zero here, so a DOS record copied over this one later is
; what makes the disk bootable. Bytes 9-19 are the parameter block every
; Atari DOS boot record carries below its entry point; spift fills in the
; density fields (14 and 17) so the record describes the disk it is on even
; though nothing here reads them.

LOAD = $0700
; Zero page pointer to the top-left of the screen, set up by the OS long
; before it boots anything.
SAVMSC = $58
; The screen holds internal codes, not ATASCII: for the printable range
; $20-$5F the two differ by exactly this.
SCREEN_CODE_BIAS = $20
COLUMNS = 40

.segment "OUTPUT"
.org LOAD

	; Disk boot header. The sector count is what the OS loads and what
	; spift rewrites per variant - one sector for DOS 1.0, three for the
	; rest, matching what each filesystem reserves.
	.byte 0				; flags
	.byte 1				; number of boot sectors
	.word LOAD			; load address
	.word init			; init address, which the OS puts in DOSINI

	; The OS calls the continuation here, at LOAD+6. Jumping clear of the
	; parameter block is what every Atari DOS record does, so the bytes
	; below stay data.
	jmp start

	; Bytes 9-19: the parameter block. Left zero - byte 14 zero is the
	; marker that says this disk will not boot - and spift patches the
	; density fields in.
	.res 11

start:
	; Two lines of text straight into screen memory. Going through E:
	; would mean an IOCB and a CIO call for no gain: the OS has set the
	; display up, nothing else is on it, and this way the code cannot
	; fail part way and leave the machine looking hung for another reason.
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

	; Exactly two 40-column rows, so the copy loop needs no terminator.
message:
	.byte "THIS DISK HAS A FILE SYSTEM BUT NO DOS. "
	.byte "PRESS RESET.                            "
message_length = * - message
