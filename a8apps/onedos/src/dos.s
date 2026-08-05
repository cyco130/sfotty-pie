.import "./lib/xex-output.s"
sio = .import "./lib/sio.s"
cio = .import "./lib/cio.s"

adfs = .import "./adfs/adfs.s"

.import "./public.s"
; disk_io = .import "./disk-io.s"
; buffers = .import "./buffers.s"

output_xex cold_init, DOSLOAD, dos_end

; OS equates

DOSVEC := $0A, size: 2
DOSINI := $0C, size: 2

MEMLO  := $02E7, size: 2
HATABS := $031A, size: 35


;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;

.segment "INIT"

; Cold initialization runs once when the DOS is first loaded
cold_init:
	lda 8
	ldy #0
	sta (88),y
	; Set up public information
	lda #'1'
	sta MDOSCODE
	sta DOSCODE
	lda #0
	sta MDOSVER
	sta DOSVER

	lda #sio::Command::PUT
	sta WRTCMD

	; Set up DOSINI to point to warm_init
	lda #<warm_init
	sta DOSINI
	lda #>warm_init
	sta DOSINI + 1

	; Set up DOSVEC to point to shell
	lda #<shell
	sta DOSVEC
	lda #>shell
	sta DOSVEC + 1

	; Return to OS with success
	clc
	rts

.code

;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;

; Warm initialization runs after every reset
warm_init:
	; Set MEMLO
	lda #<dos_end
	sta MEMLO
	lda #>dos_end
	sta MEMLO + 1

	; Install D: handler
	ldx #-3
@search:
	inx
	inx
	inx
	lda HATABS,x
	bne @search

	; Found
	lda #'D'
	sta HATABS,x
	lda #<d_handlers
	sta HATABS+1,x
	lda #>d_handlers
	sta HATABS+2,x

	; Return to OS
	rts

;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;

d_close:
	ldy #1

d_get:
d_put:
d_status:
d_special:
	rts

;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;

; Shell entry, entered, e.g., when the user types "DOS" at the BASIC prompt
shell:
	println "Shell"

	; Return to caller (will crash if caller is OS)
	rts

;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;
; D: handler table
.rodata
	d_handlers:
		.word adfs::open - 1
		.word d_close - 1
		.word d_get - 1
		.word d_put - 1
		.word d_status - 1
		.word d_special - 1

.macro println msg, rodata = "RODATA"
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

	current_segment = .segment()
	.segment rodata
		msg_addr: .byte msg, $9B
	.segment current_segment
.endmacro
