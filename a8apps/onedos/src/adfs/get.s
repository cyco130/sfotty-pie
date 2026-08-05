.import "../lib/error.s"
cio = .import "../lib/cio.s"
sio = .import "../lib/sio.s"

.code

.export get:
	; No burst I/O if we're in the middle of a buffered I/O operation
	lda cio::ICAX5,x
	bne @single_byte_io

	; No burst I/O if the source buffer is smaller than a full sector
	ldx cio::ICDNOZ
	ldy drive_sector_sizes,x
	lda cio::ICBLLZ
	dey
	cmp sector_sizes_lo,y
	lda cio::ICBLHZ
	sbc sector_sizes_hi,y
	bcc @single_byte_io

	; Perform burst I/O: Read the sector from disk into the user buffer
	lda #sio::Device::D1
	sta sio::DDEVIC
	lda #cio::ICDNOZ
	sta sio::DUNIT
	lda #sio::Command::READ
	sta sio::DCOMND
	lda #sio::Direction::DEVICE_TO_COMPUTER
	sta sio::DSTATS
	lda cio::ICBALZ
	sta sio::DBUFLO
	lda cio::ICBAHZ
	sta sio::DBUFHI
	lda sector_sizes_lo,y
	sta sio::DBYTLO
	lda sector_sizes_hi,y
	sta sio::DBYTHI
	jsr sio::SIOV
	bmi @return

	; Update the CIO buffer length to reflect the number of bytes read minus one
	; Because CIO will decrement it afterwards.
	ldx cio::ICDNOZ
	ldy drive_sector_sizes,x
	dey
	lda cio::ICBLLZ
	sec
	sbc sector_sizes_lo,y
	sta cio::ICBLLZ
	lda cio::ICBLHZ
	sbc sector_sizes_hi,y
	sta cio::ICBLHZ

	inc cio::ICBLLZ
	bne @skip
	inc cio::ICBLHZ

@skip:
	; Get the last byte into A
	lda sector_sizes_lo,y
	tay
	dey
	lda (cio::ICBALZ),y
	ldy #1

@return:
	; Return to caller
	rts

@single_byte_io:
	; TODO: Ensure the sector is in buffer
	; TODO: Read from the buffer and update buffer pointers
	rts

.bss

drive_sector_sizes: .res 15 ; Sector size (0: unknown, 1: 128, 2: 256, 3: 512)

.rodata
sector_sizes_lo: .byte <128, <256
sector_sizes_hi: .byte >128, >256
