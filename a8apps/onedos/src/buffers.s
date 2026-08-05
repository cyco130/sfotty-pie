.import "./config.s"

.import "./public.s"
.import "./lib/error.s"
sio = .import "./lib/sio.s"

.code

;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;

; Allocate a buffer slot
;
; In:
;   X: Number of consecutive buffer slots to allocate
;
; Out:
;   N:             Clear on success
;   Y:             (on success) Index of the allocated buffer slot
;   DBUFLO/DBUFHI: (on success) Address of the allocated buffer slot
;
.export allocate:
	stx ptr1
	ldy #MAX_BUFFER_SLOTS - 1

@loop:
	lda statuses,y
	beq @found_one
	dey
	bpl @loop

	; Not found
	; TODO: Compact/evict and try again
	rts

@found_one:
	dex
	beq compute_buffer_address
	ldx ptr1
	bne @loop ; Always taken

compute_buffer_address:
	tya
	lsr a
	sta tmp1
	lda #0
	ror a
	adc #<base
	sta sio::DBUFLO
	lda tmp1
	adc #>base
	sta sio::DBUFHI
	rts

;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;

; Flush a disk buffer slot to disk if it's dirty
;
; In:
;   Y: Index of the buffer slot to flush
;
; Out:
;   N:             Clear on success
;   DBUFLO/DBUFHI: (on success) Address of the flushed buffer slot
;
.export flush_if_dirty:
	lda statuses,y
	bmi do_flush
	rts

; Flush the buffer slot to disk
.export flush:
	lda statuses,y
do_flush:
	and #$0f ; Get drive number
	sta sio::DUNIT
	lda #sio::Device::D1
	sta sio::DDEVIC
	lda WRTCMD
	sta sio::DCOMND
	lda #sio::Direction::COMPUTER_TO_DEVICE
	sta sio::DSTATS


;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;;

.export flush_disk:
	sta tmp1
	ldy #MAX_BUFFER_SLOTS - 1
@loop:
	lda statuses,y
	bmi @check_drive_no
@continue:
	dey
	bpl @loop
	rts

@check_drive_no:
	ldx tmp1
	beq @flush
	and #$0F ; Get drive number
	cmp tmp1
	bne @continue

@flush:
	sta sio::DUNIT

	lda #sio::Device::D1
	sta sio::DDEVIC

	lda #sio::Command::WRITE
	sta sio::DCOMND

	lda #sio::Direction::COMPUTER_TO_DEVICE
	sta sio::DSTATS

	lda #128
	sta sio::DBYTLO
	lda #0
	sta sio::DBYTHI

	jsr compute_buffer_address

	rts



.bss

.export base:
	.res MAX_BUFFER_SLOTS * 128 ; Buffer slots (each slot is 128 bytes)

.export statuses:
	; Low nibble holds drive number (0 means free), high nibble holds status (7: dirty)
	.res MAX_BUFFER_SLOTS

.export sector_lo:
	.res MAX_BUFFER_SLOTS ; Low byte of the sector number for each buffer slot

.export sector_hi:
	.res MAX_BUFFER_SLOTS ; High byte of the sector number for each buffer slot
