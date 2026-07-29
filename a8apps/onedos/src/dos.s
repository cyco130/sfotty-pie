.import "./lib/xex-output.s"
cio = .import "./lib/cio.s"

LOAD_ADDRESS = $0700

output_xex cold_init, LOAD_ADDRESS, dos_end

; OS equates

DOSVEC := $0A, size: 2
DOSINI := $0C, size: 2

MEMLO  := $02E7, size: 2

.segment "INIT"

cold_init:
	println "Cold"

	lda #<warm_init
	sta DOSINI
	lda #>warm_init
	sta DOSINI + 1

	lda #<dos
	sta DOSVEC
	lda #>dos
	sta DOSVEC + 1

	clc
	rts

.code

warm_init:
	println "Warm"

	; Set MEMLO
	lda #<dos_end
	sta MEMLO
	lda #>dos_end
	sta MEMLO + 1

	; Return to OS
	rts

dos:
	println "Shell"

	; Return to caller (will crash if caller is OS)
	rts

.rodata
msg_installed:
	.byte "OneDOS installed", $9B
msg_dos_entered:
	.byte "OneDOS entered", $9B

.macro println msg
	ldx #0
	lda #cio::Command::PUTREC
	sta cio::ICCOM
	lda #<msg_addr
	sta cio::ICBAL
	lda #>msg_addr
	sta cio::ICBAH
	lda #$FF
	sta cio::ICBLL
	sta cio::ICBLH
	jsr cio::CIOV
.rodata
	msg_addr: .byte msg, $9B
.code
.endmacro
