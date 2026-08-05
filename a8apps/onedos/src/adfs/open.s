.import "../lib/error.s"
cio = .import "../lib/cio.s"

.import "../parse-drive-no.s"
.import "../handler-helpers.s"

.export open

.code

open:
	enter_cio
	; Only allow read mode
	lda cio::ICAX1Z
	cmp #cio::OpenMode::READ
	beq open_for_read

	; Not implemented
	ldy #Error::FNCNOT
	rts

open_for_read:
	; Expand file name
	; Search file
	; If found, fill in IOCB and return success
	; If not found, return error

	jsr parse_drive_no

;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;

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
parse_drive_number:
	ldy #1 ; Point past the initial 'D'
	lda (cio::ICBALZ),y
	cmp #':'
	bne @parse_drive
	dec cio::ICDNOZ ; CIO must have set it to 1, so decrement to 0
	clc
	rts

	; Parse drive number
@parse_drive:
	sec
	sbc #'0'
	cmp #10
	bcc @skip_colon

	txa
	sbc #'A' - '0'
	bcc @invalid_drive
	cmp #16
	bcc @skip_colon

@invalid_drive:
	sec
	rts

@skip_colon:
	sta cio::ICDNOZ
	iny
	lda (cio::ICBALZ),y
	cmp #':'
	bne @invalid_drive

;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;

; Expand file name
;
; in:
;   (cio::ICBALZ),y <- Pointer to file name string
;   ?               <- Allow non-letters as first character, and '_' and '@' anywhere (SpartDOS convention)
;
; out:
;   C               <- Clear on success
;   file_name       <- (on success) Expanded file name (11 bytes, name and extension padded with spaces)
;   (cio::ICBALZ),y <- (on success) Pointer to next character in file name string
;
; If Y ever exceeds 127, an error is returned.
expand_file_name:
	; Check first letter
	lda (cio::ICBALZ),y
	cmp #'A'
	bcc @invalid_file_name
	cmp #'Z' + 1
	bcs @invalid_file_name

	sta file_name
	ldx #1
	lda #8
	sta part_length

	; Check subsequent letters
@check_next_char:
	iny
	lda (cio::ICBALZ),y

	cmp #'.'
	beq @part_done

	cmp #'?'
	beq @ok

	cmp #'*'
	beq @expand_star

	cmp #'A'
	bcc @not_letter
	cmp #'Z' + 1
	bcs @invalid_file_name

@not_letter:
	cmp #'0'
	bcc @all_done
	cmp #'9' + 1
	bcs @all_done

@ok:
	sta file_name,x
	cpx part_length
	bne @check_next_char
	inx
	bne @check_next_char ; Always taken

@part_done:
	iny
	lda part_length
	cmp #3
	beq @all_done
	lda #3
	sta part_length
	bne @check_next_char ; Always taken

@expand_star:
	iny
	cpx part_length
	beq @check_next_char
	lda #'?'
	sta file_name,x
	inx
	bne @expand_star ; Always taken

@all_done:
	clc
	rts

@invalid_file_name:
	sec
	rts

.bss
	file_name: .res 11
	part_length: .res 1

