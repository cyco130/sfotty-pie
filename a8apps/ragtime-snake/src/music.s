.import "./lib/atari/pokey.s"
.import "./lib/atari/gtia.s"

.rodata
	pal_notes:
		emit_8_bit_pal_notes

	ntsc_notes:
		emit_8_bit_ntsc_notes

TIME_UNIT_PAL = 6
TIME_UNIT_NTSC = 7

	channel_1_notes:
		.byte NoteOffsets::E4
		.byte NoteOffsets::C5
		.byte NoteOffsets::F4
		.byte NoteOffsets::A4
		.byte NoteOffsets::G4
		.byte NoteOffsets::B4
		.byte NoteOffsets::G4
		.byte NoteOffsets::E5
		.byte NoteOffsets::D5
		.byte NoteOffsets::C5
		.byte NoteOffsets::D5
		.byte NoteOffsets::Ds5
		.byte NoteOffsets::E5
		.byte NoteOffsets::B4
		.byte NoteOffsets::D5
		.byte NoteOffsets::C5
		.byte NoteOffsets::G4
		.byte NoteOffsets::C5
		.byte $FF

	channel_1_lengths:
		; 32 units total
		.byte 2
		.byte 2
		.byte 1
		.byte 2
		.byte 2
		.byte 2
		.byte 1
		.byte 2
		.byte 2
		.byte 1
		.byte 1
		.byte 1
		.byte 2
		.byte 1
		.byte 2
		.byte 2
		.byte 2
		.byte 4

	channel_2_notes:
		.byte $FE, NoteOffsets::C4
		.byte $FE, NoteOffsets::C4
		.byte $FE, NoteOffsets::B3
		.byte $FE, NoteOffsets::B3

		.byte $FE, NoteOffsets::C4
		.byte $FE, NoteOffsets::B3
		.byte $FE, NoteOffsets::B3
		.byte NoteOffsets::C4

	channel_2_lengths:
		.byte 2, 2
		.byte 2, 2
		.byte 2, 2
		.byte 2, 2

		.byte 2, 2
		.byte 2, 2
		.byte 2, 2
		.byte 4

	channel_3_notes:
		.byte $FE, NoteOffsets::E4
		.byte $FE, NoteOffsets::F4
		.byte $FE, NoteOffsets::D4
		.byte $FE, NoteOffsets::D4

		.byte NoteOffsets::E4
		.byte NoteOffsets::F4
		.byte NoteOffsets::Fs4
		.byte NoteOffsets::G4
		.byte NoteOffsets::G4
		.byte NoteOffsets::B4

		.byte NoteOffsets::D4
		.byte NoteOffsets::E4

	channel_3_lengths:
		.byte 2, 2
		.byte 2, 2
		.byte 2, 2
		.byte 2, 2

		.byte 1, 1, 1, 2
		.byte 1, 4
		.byte 2, 4

	channel_4_notes:
		.byte NoteOffsets::C3
		.byte NoteOffsets::F3
		.byte NoteOffsets::G3
		.byte NoteOffsets::E3
		.byte NoteOffsets::C3
		.byte NoteOffsets::G3
		.byte NoteOffsets::G3
		.byte NoteOffsets::C3

	channel_4_lengths:
		.byte 4
		.byte 4
		.byte 4
		.byte 4

		.byte 4
		.byte 6
		.byte 2
		.byte 4

.zeropage
	notes: .res 2
	time_unit: .res 1

	zero_page_start:
	units: .res 1

	ch1index: .res 1
	ch1dur: .res 1
	ch1vol: .res 1

	ch2index: .res 1
	ch2dur: .res 1
	ch2vol: .res 1

	ch3index: .res 1
	ch3dur: .res 1
	ch3vol: .res 1

	ch4index: .res 1
	ch4dur: .res 1
	ch4vol: .res 1

	zero_page_length = * - zero_page_start

.code

.export init:
	lda #0
	sta AUDCTL

	ldx #zero_page_length
	clear_loop:
		sta zero_page_start - 1,x
		dex
	bne clear_loop

	lda PAL
	and #TvSystem::MASK

	beq is_pal
		lda #<ntsc_notes
		sta notes
		lda #>ntsc_notes
		sta notes+1
		lda #TIME_UNIT_NTSC
		sta time_unit
		rts
	is_pal:
		lda #<pal_notes
		sta notes
		lda #>pal_notes
		sta notes+1
		lda #TIME_UNIT_PAL
		sta time_unit
		rts

.export tick:
	; Update volumes
	lda ch1vol
	beq ch1vol_not_zero
		dec ch1vol
	ch1vol_not_zero:
	ora #Audc::NO_NOISE | Audc::NO_BUZZ
	sta AUDC1

	lda ch2vol
	beq ch2vol_not_zero
		dec ch2vol
	ch2vol_not_zero:
	ora #Audc::NO_NOISE | Audc::NO_BUZZ
	sta AUDC2

	lda ch3vol
	beq ch3vol_not_zero
		dec ch3vol
	ch3vol_not_zero:
	ora #Audc::NO_NOISE | Audc::NO_BUZZ
	sta AUDC3

	lda ch4vol
	beq ch4vol_not_zero
		dec ch4vol
	ch4vol_not_zero:
	ora #Audc::NO_NOISE | Audc::NO_BUZZ
	sta AUDC4

	lda units
	beq process_unit
		dec units
		rts
	process_unit:

	lda time_unit
	sta units

	; Process channel 1 if done
	lda ch1dur
	bne ch1_not_done
		ldx ch1index
		ldy channel_1_notes,x
		cpy #$FF
		bne not_rewind
			; Rewind to the start of the song
			ldy #0
			ldx #0
			sty ch1index
			sty ch2index
			sty ch3index
			sty ch4index
			sty ch1dur
			sty ch2dur
			sty ch3dur
			sty ch4dur
			ldy channel_1_notes,x
		not_rewind:
		inc ch1index
		lda (notes),y
		sta AUDF1
		lda #Audc::NO_NOISE | Audc::NO_BUZZ | 9
		sta AUDC1
		lda #7
		sta ch1vol
		lda channel_1_lengths,x
		sta ch1dur
	ch1_not_done:

	; Process channel 2 if done
	lda ch2dur
	bne ch2_not_done
		ldx ch2index
		inc ch2index
		ldy channel_2_notes,x
		cpy #$FE
		bne ch2_not_muted
			lda #Audc::NO_NOISE | Audc::NO_BUZZ | 0
			sta AUDC2
			lda #0
			jmp ch2_get_length
		ch2_not_muted:
			lda (notes),y
			sta AUDF2
			lda #Audc::NO_NOISE | Audc::NO_BUZZ | 6
			sta AUDC2
			lda #4
		ch2_get_length:
		sta ch2vol
		lda channel_2_lengths,x
		sta ch2dur
	ch2_not_done:

	; Process channel 2 if done
	lda ch3dur
	bne ch3_not_done
		ldx ch3index
		inc ch3index
		ldy channel_3_notes,x
		cpy #$FE
		bne ch3_not_muted
			lda #Audc::NO_NOISE | Audc::NO_BUZZ | 0
			sta AUDC3
			lda #0
			jmp ch3_get_length
		ch3_not_muted:
			lda (notes),y
			sta AUDF3
			lda #Audc::NO_NOISE | Audc::NO_BUZZ | 6
			sta AUDC3
			lda #4
		ch3_get_length:
		sta ch3vol
		lda channel_3_lengths,x
		sta ch3dur
	ch3_not_done:

	; Process channel 4 if done
	lda ch4dur
	bne ch4_not_done
		ldx ch4index
		inc ch4index
		ldy channel_4_notes,x
		lda (notes),y
		sta AUDF4
		lda #Audc::NO_NOISE | Audc::NO_BUZZ | 12
		sta AUDC4
		lda #10
		sta ch4vol
		lda channel_4_lengths,x
		sta ch4dur
	ch4_not_done:

	; Decrement the durations and return
	dec ch1dur
	dec ch2dur
	dec ch3dur
	dec ch4dur
	rts
