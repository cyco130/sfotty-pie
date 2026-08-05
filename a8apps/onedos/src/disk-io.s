.import "./config.s"
.import "./public.s"
sio = .import "./lib/sio.s"
cio = .import "./lib/cio.s"

.code

.export write_sector:
	jsr detect_disk_if_needed
	lda WRTCMD
	sta sio::DCOMND
	lda #sio::Direction::COMPUTER_TO_DEVICE
	bne call_sio ; Always taken

.export read_sector:
	jsr detect_disk_if_needed
	lda #sio::Command::READ
	sta sio::DCOMND
	lda #sio::Direction::DEVICE_TO_COMPUTER
	; Fall through to call_sio

call_sio:
	sta sio::DSTATS

	lda #sio::Device::D1
	sta sio::DDEVIC

	ldx #cio::ICDNOZ
	stx sio::DUNIT

	lda disk_sector_sizes,x
	cmp #2 ; Is it DD (256 bytes)?
	bne @set_sector_size

	; When DD, first 3 sectors should still be 128 byte
	ldx sio::DAUX2
	bne @set_sector_size
	ldx #3
	cpx sio::DAUX1
	bcs @set_sector_size
	lda #1 ; Set to 128 bps

@set_sector_size:
	lsr a
	sta sio::DBYTHI
	lda #0
	ror a
	sta sio::DBYTLO

	jmp JSIO

.export detect_disk_if_needed:
	ldx #cio::ICDNOZ
	lda disk_sector_sizes,x
	beq detect_disk
	clc
	rts

; Detect disk file system and sector size
;
; in:
;   ICDNOZ <- drive number
;
; out:
;   C                         <- Clear on success
;   disk_sector_sizes[ICDNOZ] <- Sector size/128
;   disk_file_systems[ICDNOZ] <- File system
.export detect_disk:
	lda #sio::Device::D1
	sta sio::DDEVIC

	lda cio::ICDNOZ
	sta sio::DUNIT

	lda #sio::Command::READ
	sta sio::DCOMND

	lda #sio::Direction::DEVICE_TO_COMPUTER
	sta sio::DSTATS

	lda #128
	sta sio::DBYTLO
	lda #0
	sta sio::DBYTHI

	sta tmp_buffer + BootSectorOffsets::JMP ; Clear the JMP instruction to check for success
	lda #<tmp_buffer
	sta sio::DBUFLO
	lda #>tmp_buffer
	sta sio::DBUFHI

	jsr JSIO

	; Assume Atari DOS
	ldx cio::ICDNOZ
	lda #1
	sta disk_file_systems,x

	lda tmp_buffer + BootSectorOffsets::JMP
	cmp #$4C ; Check for JMP absolute instruction
	bne @error

	lda #1 ; Assume SD

	ldy tmp_buffer + BootSectorOffsets::JMP + 2
	beq @adfs ; If the address is zero, it's possibly Atari DOS
	cpy #$80
	beq @sdfs
	cpy #$40
	beq @sdfs

@error:
	lda #0
	sta disk_file_systems,x
	sta disk_sector_sizes,x
	sec
	rts

@adfs:
	ldy tmp_buffer + BootSectorOffsets::ADFS_SECTOR_LINK_OFFSET
	cpy #125
	beq @sd
	cpy #253
	beq @dd
	bne @error ; Always taken

@sdfs:
	asl disk_file_systems,x
	ldy tmp_buffer + BootSectorOffsets::SDFS_SECTOR_SIZE_OFFSET
	beq @dd
	cpy #$80
	beq @sd
	cpy #$01
	bne @error
	asl a
@dd:
	asl a
@sd:
	sta disk_sector_sizes,x
	clc
	rts

.bss

; Sector size/128 for each drive (0 = unknown, 1 = 128 bytes, 2 = 256 bytes, 4 = 512 bytes, 64 = 8192 bytes)
.export disk_sector_sizes := disk_sector_sizes_1 - 1
; File system type for each drive (0 = Unknown, 1 = ADFS, 2 = SDFS)
.export disk_file_systems := disk_file_systems_1 - 1

disk_sector_sizes_1: .res DRIVE_NO_MAX
disk_file_systems_1: .res DRIVE_NO_MAX

tmp_buffer: .res 128

BootSectorOffsets = {
	JMP: 6 ; Should contain a JMP absolute instruction ($4C <address>)

	ADFS_SECTOR_LINK_OFFSET: $11 ; Offset to the sector link field in data sectors

	SDFS_SECTOR_SIZE_OFFSET: $1F ; Sector size: $00 -> 256 bytes, $80 -> 128 bytes, $01 -> 512 bytes.
}
