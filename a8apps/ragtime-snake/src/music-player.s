; The music player for the two-stream format midi2s.ts emits: a section list
; and an instruction stream per channel, driven one vblank at a time. The
; generated music.s carries the instruction set at the top of the file.
;
; The player owns no song. The harness points `sections` at the four section
; lists and calls `init`; `tick` returns with carry set once channel 1 runs
; out of song, and the harness restarts it the same way. Channel 1 decides
; because the channels are otherwise independent - they are cut to the same
; length, so the others reach their terminator on the same unit.
;
; Everything is indexed by the channel's X - 0, 2, 4 or 6 - which is both the
; offset from AUDF1/AUDC1 to that channel's POKEY registers and the stride of
; the tables below.

.import "./lib/atari/pokey.s"
.import "./lib/atari/gtia.s"

CHANNELS = 4

TIME_UNIT_PAL = 7
TIME_UNIT_NTSC = 9

; Tone rather than noise, on every channel.
TONE = Audc::NO_NOISE | Audc::NO_BUZZ

.rodata
	pal_notes:
		emit_8_bit_pal_notes

	ntsc_notes:
		emit_8_bit_ntsc_notes

	; The envelope, one lookup per vblank: `decay,y` is next vblank's volume
	; given this one's, which is floor(volume * 7/8). A loud note falls by
	; two and a quiet one by one, so a strike at 9 is silent 8 vblanks later
	; - a curve, where subtracting a fixed step gave a straight line.
	decay:
		.byte 0, 0, 1, 2, 3, 4, 5, 6
		.byte 7, 7, 8, 9, 10, 11, 12, 13

.zeropage
	; Stream pointers, two bytes per channel, indexed by the channel's X.
	; The next section-list entry to read, filled in by the harness
	.export sections:
		.res 2 * CHANNELS
	notes: .res 2 * CHANNELS ; the next instruction to read

	note_table: .res 2 ; PAL or NTSC periods, indexed by note offset

.bss
	time_unit: .res 1 ; vblanks per duration unit, once the TV is known
	units: .res 1 ; vblanks left in the current unit

	; Per-channel state on the same X as the pointers, which is what sharing
	; an index with POKEY costs: eight bytes each, of which four are used.
	countdown: .res 2 * CHANNELS ; units left on the note being played
	duration: .res 2 * CHANNELS ; sticky duration: units the next note lasts
	volume: .res 2 * CHANNELS ; sticky volume: the level a note strikes at
	level: .res 2 * CHANNELS ; that note's volume right now, part way down

.code

; Start the song. The harness must have filled in `sections` first.
.export init:
	lda #0
	sta AUDCTL

	ldx #2 * CHANNELS - 2
	init_channel:
		lda #0
		sta countdown,x
		sta duration,x
		sta volume,x
		sta level,x
		sta AUDC1,x
		jsr pull_section
		dex
		dex
	bpl init_channel

	; Due immediately, so the first tick starts the first note.
	lda #1
	sta units

	lda PAL
	and #TvSystem::MASK
	bne init_ntsc
		lda #<pal_notes
		sta note_table
		lda #>pal_notes
		sta note_table+1
		lda #TIME_UNIT_PAL
		sta time_unit
		rts
	init_ntsc:
		lda #<ntsc_notes
		sta note_table
		lda #>ntsc_notes
		sta note_table+1
		lda #TIME_UNIT_NTSC
		sta time_unit
	rts

; Call once per frame. Returns with carry set when channel 1 has played its
; last section, which means the song is over.
.export tick:
	; Every channel takes one step down the decay curve.
	ldx #2 * CHANNELS - 2
	tick_decay:
		ldy level,x
		lda decay,y
		sta level,x
		ora #TONE
		sta AUDC1,x
		dex
		dex
	bpl tick_decay

	; A unit spans several vblanks; only its last one moves the song on.
	dec units
	beq tick_unit
		clc
		rts
	tick_unit:
	lda time_unit
	sta units

	ldx #0
	tick_channel:
		lda countdown,x
		bne tick_sounding
			jsr advance
			bcc tick_sounding
			; Out of song. Channel 1 calls it; the others just fall silent
			; and wait, since they should be ending on this same unit.
			cpx #0
			beq tick_ended
			lda #0
			sta level,x
			lda #$7F
			sta countdown,x
		tick_sounding:
		dec countdown,x
		inx
		inx
		cpx #2 * CHANNELS
	bne tick_channel

	clc
	rts

	tick_ended:
	sec
	rts

; Read channel X's instructions up to and including the next note or rest,
; applying the sticky volume and duration on the way. Carry set means the
; channel reached the end of its section list.
advance:
	advance_next:
		lda (notes,x)
		inc notes,x
		bne advance_decode
			inc notes+1,x
		advance_decode:

		; Compare rather than test N: the pointer bump above just wrote the
		; flags, and only cmp reads them back from the instruction byte.
		cmp #$80
		bcs advance_duration ; $80..$FF: set the duration
		cmp #$40
		bcc advance_note ; $00..$3F: strike a note
		cmp #$60
		bcc advance_volume ; $4x: set the volume
		beq advance_rest ; $60: rest
		cmp #$61
		beq advance_section ; $61: next section
		cmp #$63
		beq advance_hold ; $63: hold
		sec ; $62: end of song
		rts

	; A tie: the note carries on into this duration, still fading, without
	; being struck again. Nothing to write - the decay loop owns AUDC, and
	; AUDF already holds the pitch.
	advance_hold:
		lda duration,x
		sta countdown,x
		clc
		rts

	advance_duration:
		and #$7F
		sta duration,x
	jmp advance_next

	advance_volume:
		and #Audc::VOLUME_MASK
		sta volume,x
	jmp advance_next

	advance_section:
		jsr pull_section
		bcc advance_next
		rts

	advance_rest:
		lda #0
		sta level,x
		jmp advance_strike

	advance_note:
		tay
		lda (note_table),y
		sta AUDF1,x
		lda volume,x
		sta level,x

	advance_strike:
		ora #TONE
		sta AUDC1,x
		lda duration,x
		sta countdown,x
		clc
		rts

; Point channel X's instruction pointer at its next section and step the
; section pointer past that entry. Carry set means the entry was $0000, which
; ends the list.
pull_section:
	lda (sections,x)
	sta notes,x
	jsr bump_section
	lda (sections,x)
	sta notes+1,x
	jsr bump_section

	ora notes,x
	beq pull_section_end
	clc
	rts
	pull_section_end:
	sec
	rts

; Step channel X's section pointer on by a byte.
bump_section:
	inc sections,x
	bne bump_section_done
		inc sections+1,x
	bump_section_done:
	rts
