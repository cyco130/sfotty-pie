; Atari BASIC booter by Fatih Aygun.
;
; Three single-density boot sectors loaded at $9A20. The OS boots them and
; calls `init` through DOSINI; the loader installs a B: device serving the
; tokenized BASIC file laid out from sector 4 onward - `file_size` is patched
; by the image builder - and patches the E: GET BYTE handler to type
; `RUN "B:"` into BASIC. The E: patch removes itself at the end of that line;
; CLOSE removes the B: device again.

.import "./atari.s"

; Top of the free memory - 512 bytes
LOAD_ADDRESS = $9a20
; Sector buffer, just past the loaded region
buffer = LOAD_ADDRESS + 3*128

; Zero page workspace. $CB-$D1 are unused by the OS and BASIC.
old_e_handlers = $CB
b_hatabs_offset = $CD
e_hatabs_offset = $CE

.define_segment "CODE"
.define_segment "RODATA"
.define_segment "DATA"

; -------------------------------------------------------------------------

; The boot image: exactly three 128-byte sectors.

.segment "OUTPUT"
.org LOAD_ADDRESS

	; Disk boot header
	.byte 0				; flags
	.byte 3				; number of boot sectors
	.word LOAD_ADDRESS	; load address
	.word init			; init address (goes to DOSINI)

	; boot-continuation entry (carry clear = boot OK);
	clc
	rts

	; File size (24-bit LSB-first; patched by the image builder)
file_size:
	.byte 0, 0, 0

	; The build script pads the image to the full three sectors (384 bytes).
	.emit "CODE"
	.emit "RODATA"
	.emit "DATA"

; -------------------------------------------------------------------------

; Global data (loaded with the boot image, so every boot starts fresh)

.segment "DATA"

buffer_offset:	.byte 128	; read position in `buffer`; 128 = empty
sector:			.word 4		; next sector to read
e_input_offset:	.byte 0		; read position in `e_input`
e_handlers:		.res 12		; RAM copy of the E: handler table (GET BYTE patched)

; -------------------------------------------------------------------------

.segment "RODATA"

e_input:
	.byte "RUN \"B:\"", $9B

b_handlers:
	.word b_open - 1
	.word b_close - 1
	.word b_get_byte - 1
	.word b_put_byte - 1
	.word b_status - 1
	.word b_special - 1

; -------------------------------------------------------------------------

.segment "CODE"

init:
	; Fake a successful disk boot
	lda #1
	sta BOOTQ
	lda #0
	sta COLDST

	; Reset will cold boot
	; TODO: Install an autorun handler that will run the BASIC program after a reset
	lda #<COLDSV
	sta DOSINI
	lda #>COLDSV
	sta DOSINI + 1

; Find free HATABS entry

	ldx #0
find_free_hatabs_entry:
	lda HATABS,x
	beq found_free_hatabs_entry
	inx
	inx
	inx
	bne find_free_hatabs_entry

; Install B: handlers
found_free_hatabs_entry:
	stx b_hatabs_offset
	lda #'B'
	sta HATABS,x
	lda #<b_handlers
	sta HATABS+1,x
	lda #>b_handlers
	sta HATABS+2,x

; Find E: entry
	lda #'E'
find_e_entry:
	dex
	dex
	dex
	cmp HATABS,x
	bne find_e_entry

; Copy E: handlers
	stx e_hatabs_offset
	lda HATABS+1,x
	sta old_e_handlers
	lda HATABS+2,x
	sta old_e_handlers + 1
	ldy #HATABS_OFFSET_SPECIAL + 1 ; Move 6 vectors (12 bytes)
copy_e_handlers:
	lda (old_e_handlers),y
	sta e_handlers,y
	dey
	bpl copy_e_handlers

; Patch E: GET BYTE handler
	lda #<(e_get_byte - 1)
	sta e_handlers + HATABS_OFFSET_GET_BYTE
	lda #>(e_get_byte - 1)
	sta e_handlers + HATABS_OFFSET_GET_BYTE + 1

; Replace E: handler pointer
	lda #<e_handlers
	sta HATABS+1,x
	lda #>e_handlers
	sta HATABS+2,x

; Done, return to the OS
	clc
	rts

; -------------------------------------------------------------------------
; E: GET BYTE handler

e_get_byte:
	ldx e_input_offset
	lda e_input,x
	cmp #$9B
	bne e_get_byte_done

; End of input, restore the original E: GET BYTE handler and return EOF

	ldx e_hatabs_offset
	lda old_e_handlers
	sta HATABS+1,x
	lda old_e_handlers + 1
	sta HATABS+2,x
	lda #$9B ; Restore the value

e_get_byte_done:
	inc e_input_offset
	pha
	jsr echo
	pla
	ldy #1
	rts

echo:
	tax
	lda ICPTL+1
	pha
	lda ICPTL
	pha
	txa
	rts

; -------------------------------------------------------------------------
; B: handlers

; B: CLOSE handler. Remove the B: handler
b_close:
	ldx b_hatabs_offset
	lda #0
	sta HATABS,x
	sta HATABS+1,x
	sta HATABS+2,x
	; Fall through for return with success

; B: OPEN handler, return with success
b_open:
return_with_success:
	ldy #1

; Not implemented (CIO calls with the function not implemented already in Y)
b_put_byte:
b_status:
b_special:
	rts

; Read a byte into A
b_get_byte:
	; Decrement `file_size`
	sec
	lda file_size
	sbc #1
	sta file_size
	lda file_size + 1
	sbc #0
	sta file_size + 1
	lda file_size + 2
	sbc #0
	sta file_size + 2
	bcs not_eof

	; Read past EOF, reset the file size to 0 and return ERR_EOF in Y
	lda #0
	sta file_size
	sta file_size + 1
	sta file_size + 2
	ldy #ERR_EOF
	rts

not_eof:
	; If the buffer is not empty, use those bytes
	ldx buffer_offset
	bpl read_from_buffer

	; Buffer is empty, fill it
	jsr fill_buffer

	; Return success with byte in A
read_from_buffer:
	lda buffer,x
	inx
	stx buffer_offset
	ldy #1
	rts

; -------------------------------------------------------------------------

; Read the next sector into `buffer`

fill_buffer:
	lda #<buffer
	sta DBUFLO
	lda #>buffer
	sta DBUFHI
	lda #$31
	sta DDEVIC
	lda #1
	sta DUNIT
	lda #$40
	sta DSTATS
	lda #SIO_READ
	sta DCOMND
	lda sector
	sta DAUX1
	lda sector + 1
	sta DAUX2
	lda #128
	sta DBYTLO
	lda #0
	sta DBYTHI
	jsr SIOV
	bpl sector_read_ok

	; Double return with error code in Y
	pla
	pla
	tya ; Set the flags according to the error code in Y
	rts

sector_read_ok:
	inc sector
	bne skip_inc_sector_high
	inc sector + 1

skip_inc_sector_high:
	ldx #0
	rts
