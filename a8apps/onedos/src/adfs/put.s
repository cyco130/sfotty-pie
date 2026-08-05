.import "../lib/error.s"
cio = .import "../lib/cio.s"

.code

.export put:
	; Check if we're called from BASIC or the OS
	tsx
	lda $0102,x      ; High byte of return address
	cmp #$C0         ; Called from OS?
	bcc @no_burst_io ; No burst I/O if not called from OS

	; TODO: No burst I/O if we're in the middle of a buffered I/O operation

	; No burst I/O if the source buffer is smaller than a full sector
	ldx cio::ICDNOZ
	ldy drive_sector_sizes,x
	dey
	lda cio::ICBLLZ
	cmp sector_sizes_lo,y
	lda cio::ICBLHZ
	sbc sector_sizes_hi,y
	bcc @no_burst_io

	; TODO: No burst I/O if the source buffer is in ROM


@no_burst_io:
	rts

	; Read the boot sector and determine the sector size for the drive from that


.bss

drive_sector_sizes: .res 15 ; Sector size (0: unknown, 1: 128, 2: 256, 3: 512)

.rodata
sector_sizes_lo: .byte <128, <256, <512
sector_sizes_hi: .byte >128, >256, >512
