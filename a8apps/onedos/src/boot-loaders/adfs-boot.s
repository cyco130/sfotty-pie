.import "../lib/boot-output.s"
sio = .import "../lib/sio.s"

LOAD_ADDRESS = $3C00

output_atari_boot LOAD_ADDRESS, init, boot_continuation

;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;

; OS equates
RUNAD  := $02E0, size: 2
INITAD := $02E2, size: 2

;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;

.segment "BOOT_PARAMS"

.res 3 ; Reserve 4 bytes for Atari DOS compatibility

boot_drive:            .byte 0 ; Drive number to boot from ($31 for D1)
link_mask:             .byte 0 ; Mask for the link bytes in a sector ($03 for AtariDOS, $00 for MyDOS)
has_dos:               .byte 0 ; 0: no DOS, 1: DOS with 128-byte sectors, 2: DOS with 256-byte sectors
dos_file_first_sector: .word 0 ; First sector of the DOS image
sector_link_offset:    .byte 0 ; Offset of the next sector link in a sector (125 or 252)

;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;

.zeropage

chunk_address: .res 2
end_address:   .res 2
buffer_offset: .res 1

.bss

buffer:     .res 256 ; Sector buffer
stack_save: .res 2   ; Saved stack pointer

;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;

.code

; The boot continuation entry
boot_continuation:
	; Save the stack pointer
	tsx
	stx stack_save

	; Check if DOS is present
	lda has_dos
	beq boot_error

	; Initialize the buffer and its offset
	ldx sector_link_offset
	lda dos_file_first_sector
	sta buffer,x
	lda dos_file_first_sector+1
	sta buffer+1,x
	lda #0
	sta buffer_offset
	sta buffer+2,x

	; Initialize RUNAD
	lda #<rts_addr
	sta RUNAD
	lda #>rts_addr
	sta RUNAD+1

	; Check $FFFF header
	jsr read_word
	bcs boot_error
	cmp #$FF
	bne boot_error
	cpx #$FF
	bne boot_error

	; Read load address
read_load_address:
	jsr read_word
	bcs eof
	cmp #$FF
	bne :+
	cpx #$FF
	beq read_load_address
:	sta chunk_address
	stx chunk_address+1

	; Read end address
	jsr read_word
	bcs boot_error
	sta end_address
	stx end_address+1
	cmp chunk_address
	txa
	sbc end_address+1
	bcc boot_error

	; Is end address reached?
check_read_address:
	lda chunk_address
	cmp end_address
	bne read_chunk
	lda chunk_address+1
	cmp end_address+1
	beq chunk_done

	; Read the chunk
read_chunk:
	jsr read_byte
	bcs boot_error
	ldy #0
	sta (chunk_address),y
	inc chunk_address
	bne check_read_address
	inc chunk_address+1
	jmp check_read_address

chunk_done:
	jsr jump_to_initad
	lda #<rts_addr
	sta INITAD
	lda #>rts_addr
	sta INITAD+1
	jmp read_load_address

;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;

eof:
	jmp (RUNAD) ; Jump to the RUNAD vector

;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;


; Restore stack pointer and return with error
boot_error:
	ldx stack_save
	txs
	sec
rts_addr:
	rts

;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;

jump_to_initad:
	jmp (INITAD) ; Jump to the INITAD vector

;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;

; Read a word from the DOS image
; out:
;    XA: word read from the DOS image
;    C: set if end of file
read_word:
	jsr read_byte
	bcc not_eof
	rts
not_eof:
	pha
	jsr read_byte
	bcs boot_error
	tax
	pla
	rts

;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;

; Buffer is empty, read the next sector
fill_buffer:
	lda buffer,x
	and link_mask
	sta sio::DAUX1
	lda buffer+1,x
	sta sio::DAUX2
	ora sio::DAUX1
	beq eof ; End of file if both link bytes are zero

	; Set drive and unit number
	lda boot_drive
	sta sio::DDEVIC
	lda #1
	sta sio::DUNIT

	; Set command
	lda #sio::Command::READ
	sta sio::DCOMND

	; Set I/O direction
	lda #sio::Direction::DEVICE_TO_COMPUTER
	sta sio::DSTATS

	; Set buffer address
	lda #<buffer
	sta sio::DBUFLO
	lda #>buffer
	sta sio::DBUFHI

	; Set byte count
	lda sector_link_offset
	clc
	adc #3
	sta sio::DBYTLO
	lda #0
	asl a ; Get carry into A
	sta sio::DBYTHI

	; Do read
	jsr sio::SIOV
	bcs boot_error

	lda #0
	sta buffer_offset

;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;

; Read one byte from the DOS image
read_byte:
	ldx sector_link_offset
	lda buffer_offset
	cmp buffer+2,x
	beq fill_buffer
	tax
	lda buffer,x
	clc
	rts

;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;

init:
	rts

