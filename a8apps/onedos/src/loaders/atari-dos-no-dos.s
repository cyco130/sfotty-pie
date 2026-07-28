.import "../lib/boot-output.s"
cio = .import "../lib/cio.s"

output_atari_boot LOAD_ADDRESS, init, boot_continuation
LOAD_ADDRESS = $3C00

WARMST = $8
BOOTQ = $9
RAMTOP = $6A
SDMCTL = $22F
CH = $2FC

PORTB = $D301
DMACTL = $D400

COLDSV = $E477

.segment "BOOT_PARAMS"
	.res 3 ; Reserve 4 bytes for Atari DOS compatibility

	boot_drive:            .byte 0 ; Drive number to boot from ($31 for D1)
	link_mask:             .byte 0 ; Mask of the link bytes in a sector ($03 for AtariDOS, $00 for MyDOS)
	has_dos:               .byte 0 ; 0: no DOS, 1: DOS with 128-byte sectors, 2: DOS with 256-byte sectors
	dos_file_first_sector: .word 0 ; First sector of the DOS image
	sector_link_offset:    .byte 0 ; Offset of the next sector link in a sector (125 or 253)

.code
	boot_continuation:
		clc
		rts

	init:
		ldx #0
		stx BOOTQ
		stx SDMCTL
		stx DMACTL
		dex
		stx WARMST

		; If RAMTOP > $A0, set it to $A0
		lda #$A0
		cmp RAMTOP
		bcs enable_basic
		lda #$A0
		sta RAMTOP

	enable_basic:
		lda PORTB
		and #~$02
		sta PORTB

		; Reopen #0
		ldx #0
		lda #$FF
		sta cio::ICHID
		lda #cio::Command::OPEN
		sta cio::ICCOM
		lda #cio::OpenMode::UPDATE
		sta cio::ICAX1
		lda #0
		sta cio::ICAX2
		lda #<e_device
		sta cio::ICBAL
		lda #>e_device
		sta cio::ICBAH
		jmp cio::CIOV

		; Check for cartridge presence
		ldx $BFFC
		bne no_cart
		dex
		stx $BFFC
		ldx $BFFC
		bne no_cart


		; Print message
		lda #cio::Command::PUTREC
		sta cio::ICCOM
		lda #<no_dos_message
		sta cio::ICBAL
		lda #>no_dos_message
		sta cio::ICBAH
		lda #$FF
		sta cio::ICBLL
		sta cio::ICBLH
		jsr cio::CIOV

		jmp ($BFFA)

	no_cart:
		; Reopen #0
		ldx #0
		lda #$FF
		sta cio::ICHID
		lda #cio::Command::OPEN
		sta cio::ICCOM
		lda #cio::OpenMode::UPDATE
		sta cio::ICAX1
		lda #0
		sta cio::ICAX2
		lda #<e_device
		sta cio::ICBAL
		lda #>e_device
		sta cio::ICBAH
		jsr cio::CIOV

		; Print message
		lda #cio::Command::PUTCHR
		sta cio::ICCOM
		lda #<no_dos_message
		sta cio::ICBAL
		lda #>no_dos_message
		sta cio::ICBAH
		lda #<(no_cart_message_end - no_dos_message)
		sta cio::ICBLL
		lda #>(no_cart_message_end - no_dos_message)
		sta cio::ICBLH
		jsr cio::CIOV

		lda #$FF
		sta CH
	wait_for_key:
		cmp CH
		beq wait_for_key

		jmp COLDSV

.rodata
	e_device:
		.byte "E:", $9B
	no_dos_message:
		.byte "No DOS", $9B
	no_cart_message:
		.byte "No cart or BASIC", $9B
		.byte "Insert DOS disk or cartridge", $9B
		.byte "Then press any key to reboot", $9B
	no_cart_message_end:

