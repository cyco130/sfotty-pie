; Atari executable booter by Fatih Aygun (ported from ca65 to spasm).
;
; Three single-density boot sectors loaded at $0700. The OS boots them and
; calls `init` through DOSINI; the loader then reads the XEX file laid out
; from sector 4 onward — `file_size` is patched by the image builder — and
; honors the INITAD/RUNAD protocol like DOS does.

.import "./atari.s"

; Sector buffer, just past the loaded boot region ($0700-$087F)
buffer = $0880

; Boot error letters, shown at the top-left of the screen. Lowercase ATASCII
; equals the screen code, so they can be stored raw.
BOOT_ERROR_FORMAT = 'f'
BOOT_ERROR_DISK = 'd'
BOOT_ERROR_CHUNK = 'c'

; Zero page workspace. This overlaps ZIOCB ($20-$2F), which any INITAD
; routine doing CIO calls will clobber — safe here, because both variables
; are freshly initialized before every read and INITAD code only runs
; between reads.
count = $20			; number of bytes to read
load_address = $22	; address to read into

.define_segment "CODE"
.define_segment "DATA"

; -------------------------------------------------------------------------

; The boot image: exactly three 128-byte sectors.

.segment "OUTPUT"
.org $0700

	; Disk boot header
	.byte 0			; flags
	.byte 3			; number of boot sectors
	.word $0700		; load address
	.word init		; init address (goes to DOSINI)

rtsadr:				; boot-continuation entry (carry clear = boot OK);
	clc				; doubles as the INITAD/RUNAD default target
	rts

	; Executable size (24-bit LSB-first; patched by the image builder)
file_size:
	.byte 0, 0, 0

	; The build script pads the image to the full three sectors (384 bytes).
	.emit "CODE"
	.emit "DATA"

; -------------------------------------------------------------------------

; Global data (loaded with the boot image, so every boot starts fresh)

.segment "DATA"

first_chunk:	.byte 1		; is this the first chunk?
buffer_offset:	.byte 128	; read position in `buffer`; 128 = empty
sector:			.word 4		; next sector to read
last_word:		.word 0		; last word read
chunk_address:	.word 0		; chunk load address

; -------------------------------------------------------------------------

.segment "CODE"

; Read a word into `last_word`

read_word:
	lda #2
	sta count
	lda #0
	sta count + 1
	lda #<last_word
	sta load_address
	lda #>last_word
	sta load_address + 1
	; Fall through to read_chunk

; Read `count` bytes into `load_address`

read_chunk:
	; Decrement `file_size`
	lda file_size
	sec
	sbc count
	sta file_size
	lda file_size + 1
	sbc count + 1
	sta file_size + 1
	lda file_size + 2
	sbc #0
	sta file_size + 2
	bcs read_ok

	; Read past EOF: the file is done — run it. (Real DOS doesn't treat a
	; short final chunk as an error either, and some XEX files rely on it.)
	pla
	pla
	jmp run

read_ok:
	; If the buffer is not empty, use those bytes
	ldy #0
	ldx buffer_offset
	bpl copy

	; Buffer is empty, fill it
refill:
	jsr fill_buffer

	; Copy the buffer
copy:
	lda count
	bne copy_next
	lda count + 1
	beq copy_done
	dec count + 1
copy_next:
	dec count
	lda buffer,x
	sta (load_address),y
	iny
	bne copy_incx
	inc load_address + 1
copy_incx:
	inx
	bpl copy
	bmi refill

copy_done:
	stx buffer_offset
	rts

; -------------------------------------------------------------------------

; Error handler: show the error letter at the top-left of the screen and hang

error:
	ldy #0
	sta (SAVMSC),y
	jmp error

; -------------------------------------------------------------------------

; The actual loader

init:
	; Reset the RUNAD vector
	lda #<rtsadr
	sta RUNAD
	lda #>rtsadr
	sta RUNAD + 1

next_chunk:
	; Skip the $FFFF header
	jsr read_word
	lda last_word
	and last_word + 1
	cmp #$FF
	beq header_ok

	; No header; if this is the first chunk, that's an error
	lsr first_chunk
	bcc store_address
	lda #BOOT_ERROR_FORMAT
	jmp error

	; Read the chunk load address
header_ok:
	lsr first_chunk
	jsr read_word

	; Store the chunk load address
store_address:
	lda last_word
	sta chunk_address
	lda last_word + 1
	sta chunk_address + 1

	; Read the chunk end address; count = end - start + 1
	jsr read_word
	inc last_word
	bne end_carried
	inc last_word + 1
end_carried:
	lda last_word
	sec
	sbc chunk_address
	sta count
	lda last_word + 1
	sbc chunk_address + 1
	sta count + 1
	bcs chunk_ok
	lda #BOOT_ERROR_CHUNK
	jmp error

chunk_ok:
	; Start from the chunk address
	lda chunk_address
	sta load_address
	lda chunk_address + 1
	sta load_address + 1

	; Reset the INITAD vector
	lda #<rtsadr
	sta INITAD
	lda #>rtsadr
	sta INITAD + 1

	; Load the chunk into memory
	jsr read_chunk

	; Call the INITAD vector
	jsr go_init

	; Loop while there are bytes to read
	lda file_size
	ora file_size + 1
	ora file_size + 2
	bne next_chunk

run:
	; Done, run the executable. If it ever returns, there is nothing left to
	; run — enter the blackboard (Memo Pad) through its public vector, which
	; also lets a host harness trap BLKBDV to end the session.
	jsr go_run
	jmp BLKBDV

	; Jump to the INITAD vector
go_init:
	jmp (INITAD)

	; Jump to the RUNAD vector
go_run:
	jmp (RUNAD)

; -------------------------------------------------------------------------

; Read the next sector into `buffer`

fill_buffer:
	tya
	pha
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
	bpl sector_read
	lda #BOOT_ERROR_DISK
	jmp error
sector_read:
	inc sector
	bne sector_carried
	inc sector + 1
sector_carried:
	ldx #0
	pla
	tay
	rts
