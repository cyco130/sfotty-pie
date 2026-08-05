.import "./config.s"
cio = .import "./lib/cio.s"

.code

; Parse drive number
;
; in:
;   (cio::ICBALZ) <- Pointer to file name string
;   cio::ICDNOZ   <- Drive number as parsed by CIO (0-9 on 400/800, 1-9 on XL/XE, 1 being the default)
;
; out:
;   C               <- Clear on success
;   cio::ICDNOZ     <- (on success) Drive number (0-15)
;   (cio::ICBALZ),y <- (on success) Points to the character just after the colon
;
.export parse_drive_no:

.if PARSE_DRIVE_NO
.else
	ldy #1 ; Skip initial 'D'
	lda (cio::ICBALZ),y
	cmp #':'
	beq @colon_found
	iny
	lda (cio::ICBALZ),y
	cmp #':'
	beq @colon_found


@colon_found:

.endif

	ldy #1 ; Skip initial 'D'
	lda (cio::ICBALZ),y
	cmp #':'
	bne parse_drive
	dec cio::ICDNOZ ; CIO must have set it to 1, so decrement to 0
	iny
	clc
	rts

	; Parse drive number
parse_drive:

.if 0
	iny
	lda (cio::ICBALZ),y
	cmp #':'
	bne invalid_drive
	iny
	clc
	rts
.else
	sec
	sbc #'0'
	cmp #10
	bcc skip_colon

	txa
	sbc #'A' - '0'
	bcc invalid_drive
	cmp #16
	bcc skip_colon

skip_colon:
	sta cio::ICDNOZ
	iny
	lda (cio::ICBALZ),y
	cmp #':'
	bne invalid_drive
	iny
	clc
	rts
.endif

invalid_drive:
	sec
	rts
