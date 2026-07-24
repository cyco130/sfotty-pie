; Generated from ragtime-snake.mid by midi2s.ts - do not edit by hand.

.import "./lib/atari/pokey.s"

; The instruction set: one byte each, volume and duration sticky. A
; section sets its own duration before its first note, since it can be
; reached from anywhere in the list; only the first section sets the
; volume. The section list is one address per section, $0000-terminated.

; $00-$3F
.macro note offset
	.byte offset
.endmacro

; $4x
.macro volume level
	.byte $40 | level
.endmacro

; silence, volume untouched
.macro rest
	.byte $60
.endmacro

; on to the next list entry
.macro next_section
	.byte $61
.endmacro

; unused: $0000 ends the list
.macro end_of_song
	.byte $62
.endmacro

; keep sounding, do not strike
.macro hold
	.byte $63
.endmacro

; 1-127
.macro duration units
	.byte $80 | units
.endmacro

.rodata

	; POKEY channel 1: 172 notes, 0 rests, 8 sections (5 distinct), 165 bytes
	.export channel_1_music:
	; section 0 - first heard at bars 1-4
	channel_1_section_0:
		; bar 1
		volume 9
		duration 2
		note NoteOffsets::E4
		note NoteOffsets::C5
		duration 1
		note NoteOffsets::F4
		duration 2
		note NoteOffsets::A4
		note NoteOffsets::G4
		; bar 2
		note NoteOffsets::B4
		duration 1
		note NoteOffsets::G4
		duration 2
		note NoteOffsets::E5
		note NoteOffsets::D5
		; bar 3
		duration 1
		note NoteOffsets::C5
		note NoteOffsets::D5
		note NoteOffsets::Ds5
		duration 2
		note NoteOffsets::E5
		duration 1
		note NoteOffsets::B4
		duration 2
		note NoteOffsets::D5
		; bar 4
		note NoteOffsets::C5
		note NoteOffsets::G4
		duration 4
		note NoteOffsets::C5
		next_section
	; section 1 - first heard at bars 9-12
	channel_1_section_1:
		; bar 9
		duration 2
		note NoteOffsets::C5
		duration 1
		note NoteOffsets::C5
		note NoteOffsets::B4
		note NoteOffsets::A4
		duration 2
		note NoteOffsets::G4
		note NoteOffsets::F4
		; bar 10
		duration 1
		note NoteOffsets::F4
		note NoteOffsets::G4
		note NoteOffsets::A4
		duration 4
		note NoteOffsets::G4
		; bar 11
		duration 2
		note NoteOffsets::C5
		duration 1
		note NoteOffsets::C5
		note NoteOffsets::B4
		note NoteOffsets::A4
		duration 2
		note NoteOffsets::G4
		note NoteOffsets::F4
		; bar 12
		duration 1
		note NoteOffsets::F4
		note NoteOffsets::E4
		note NoteOffsets::D4
		duration 4
		note NoteOffsets::C4
		next_section
	; section 2 - first heard at bars 13-16
	channel_1_section_2:
		; bar 13
		duration 2
		note NoteOffsets::C5
		duration 1
		note NoteOffsets::C5
		note NoteOffsets::B4
		note NoteOffsets::A4
		duration 2
		note NoteOffsets::G4
		note NoteOffsets::F4
		; bar 14
		duration 1
		note NoteOffsets::F4
		note NoteOffsets::G4
		note NoteOffsets::A4
		duration 4
		note NoteOffsets::G4
		; bar 15
		duration 1
		note NoteOffsets::F4
		note NoteOffsets::F4
		note NoteOffsets::G4
		note NoteOffsets::A4
		note NoteOffsets::G4
		note NoteOffsets::A4
		note NoteOffsets::B4
		duration 2
		note NoteOffsets::G4
		; bar 16
		duration 1
		note NoteOffsets::B4
		note NoteOffsets::D5
		note NoteOffsets::B4
		duration 4
		note NoteOffsets::C5
		next_section
	; section 3 - first heard at bars 17-20
	channel_1_section_3:
		; bar 17
		duration 1
		note NoteOffsets::E5
		note NoteOffsets::F5
		note NoteOffsets::Fs5
		duration 2
		note NoteOffsets::G5
		duration 1
		note NoteOffsets::G5
		note NoteOffsets::E5
		note NoteOffsets::C5
		; bar 18
		note NoteOffsets::E5
		note NoteOffsets::F5
		note NoteOffsets::Fs5
		duration 2
		note NoteOffsets::G5
		duration 1
		note NoteOffsets::G5
		note NoteOffsets::E5
		note NoteOffsets::C5
		; bar 19
		note NoteOffsets::B4
		note NoteOffsets::C5
		note NoteOffsets::Cs5
		duration 2
		note NoteOffsets::D5
		duration 1
		note NoteOffsets::D5
		note NoteOffsets::B4
		note NoteOffsets::G4
		; bar 20
		note NoteOffsets::B4
		note NoteOffsets::C5
		note NoteOffsets::Cs5
		duration 2
		note NoteOffsets::D5
		duration 1
		note NoteOffsets::D5
		note NoteOffsets::B4
		note NoteOffsets::G4
		next_section
	; section 4 - first heard at bars 21-24
	channel_1_section_4:
		; bar 21
		duration 1
		note NoteOffsets::E5
		note NoteOffsets::F5
		note NoteOffsets::Fs5
		duration 2
		note NoteOffsets::G5
		duration 1
		note NoteOffsets::G5
		note NoteOffsets::E5
		note NoteOffsets::C5
		; bar 22
		note NoteOffsets::E5
		note NoteOffsets::F5
		note NoteOffsets::Fs5
		duration 2
		note NoteOffsets::G5
		duration 1
		note NoteOffsets::G5
		note NoteOffsets::E5
		note NoteOffsets::C5
		; bar 23
		note NoteOffsets::B4
		note NoteOffsets::C5
		note NoteOffsets::Cs5
		duration 2
		note NoteOffsets::D5
		duration 1
		note NoteOffsets::D5
		note NoteOffsets::B4
		note NoteOffsets::G4
		; bar 24
		duration 2
		note NoteOffsets::B4
		note NoteOffsets::D5
		duration 4
		note NoteOffsets::G5
		next_section

	; POKEY channel 2: 72 notes, 58 rests, 8 sections (5 distinct), 97 bytes
	.export channel_2_music:
	; section 0 - first heard at bars 1-4
	channel_2_section_0:
		; bar 1
		volume 6
		duration 2
		rest
		note NoteOffsets::E4
		rest
		note NoteOffsets::F4
		; bar 2
		rest
		note NoteOffsets::D4
		rest
		note NoteOffsets::D4
		; bar 3
		duration 1
		note NoteOffsets::E4
		note NoteOffsets::F4
		note NoteOffsets::Fs4
		duration 2
		note NoteOffsets::G4
		duration 1
		note NoteOffsets::Fs4
		duration 2
		note NoteOffsets::F4
		; bar 4
		rest
		note NoteOffsets::F4
		duration 4
		note NoteOffsets::E4
		next_section
	; section 1 - first heard at bars 9-12
	channel_2_section_1:
		; bar 9
		duration 2
		rest
		note NoteOffsets::E4
		rest
		note NoteOffsets::D4
		; bar 10
		rest
		note NoteOffsets::F4
		rest
		note NoteOffsets::D4
		; bar 11
		rest
		note NoteOffsets::E4
		rest
		note NoteOffsets::D4
		; bar 12
		rest
		note NoteOffsets::G3
		rest
		note NoteOffsets::G3
		next_section
	; section 2 - first heard at bars 13-16
	channel_2_section_2:
		; bar 13
		duration 2
		rest
		note NoteOffsets::E4
		rest
		note NoteOffsets::D4
		; bar 14
		rest
		note NoteOffsets::F4
		rest
		note NoteOffsets::D4
		; bar 15
		rest
		note NoteOffsets::D4
		rest
		note NoteOffsets::F4
		; bar 16
		rest
		note NoteOffsets::F4
		note NoteOffsets::E4
		rest
		next_section
	; section 3 - first heard at bars 17-20
	channel_2_section_3:
		; bar 17
		duration 2
		rest
		note NoteOffsets::C5
		rest
		note NoteOffsets::G4
		; bar 18
		rest
		note NoteOffsets::C5
		rest
		note NoteOffsets::G4
		; bar 19
		rest
		note NoteOffsets::B4
		rest
		note NoteOffsets::G4
		; bar 20
		rest
		note NoteOffsets::B4
		rest
		note NoteOffsets::G4
		next_section
	; section 4 - first heard at bars 21-24
	channel_2_section_4:
		; bar 21
		duration 2
		rest
		note NoteOffsets::C5
		rest
		note NoteOffsets::G4
		; bar 22
		rest
		note NoteOffsets::C5
		rest
		note NoteOffsets::G4
		; bar 23
		rest
		note NoteOffsets::B4
		rest
		note NoteOffsets::G4
		; bar 24
		rest
		note NoteOffsets::A4
		note NoteOffsets::B4
		rest
		next_section

	; POKEY channel 3: 64 notes, 62 rests, 8 sections (5 distinct), 91 bytes
	.export channel_3_music:
	; section 0 - first heard at bars 1-4
	channel_3_section_0:
		; bar 1
		volume 6
		duration 2
		rest
		note NoteOffsets::C4
		rest
		note NoteOffsets::C4
		; bar 2
		rest
		note NoteOffsets::B3
		rest
		note NoteOffsets::B3
		; bar 3
		rest
		note NoteOffsets::E4
		rest
		note NoteOffsets::B3
		; bar 4
		rest
		note NoteOffsets::B3
		duration 4
		note NoteOffsets::C4
		next_section
	; section 1 - first heard at bars 9-12
	channel_3_section_1:
		; bar 9
		duration 2
		rest
		note NoteOffsets::C4
		rest
		note NoteOffsets::B3
		; bar 10
		rest
		note NoteOffsets::C4
		rest
		note NoteOffsets::B3
		; bar 11
		rest
		note NoteOffsets::C4
		rest
		note NoteOffsets::B3
		; bar 12
		rest
		note NoteOffsets::B3
		rest
		note NoteOffsets::C4
		next_section
	; section 2 - first heard at bars 13-16
	channel_3_section_2:
		; bar 13
		duration 2
		rest
		note NoteOffsets::C4
		rest
		note NoteOffsets::B3
		; bar 14
		rest
		note NoteOffsets::C4
		rest
		note NoteOffsets::B3
		; bar 15
		rest
		note NoteOffsets::B3
		rest
		note NoteOffsets::D4
		; bar 16
		rest
		note NoteOffsets::D4
		note NoteOffsets::C4
		rest
		next_section
	; section 3 - first heard at bars 17-20
	channel_3_section_3:
		; bar 17
		duration 2
		rest
		note NoteOffsets::E4
		rest
		note NoteOffsets::E4
		; bar 18
		rest
		note NoteOffsets::E4
		rest
		note NoteOffsets::E4
		; bar 19
		rest
		note NoteOffsets::G4
		rest
		note NoteOffsets::F4
		; bar 20
		rest
		note NoteOffsets::G4
		rest
		note NoteOffsets::F4
		next_section
	; section 4 - first heard at bars 21-24
	channel_3_section_4:
		; bar 21
		duration 2
		rest
		note NoteOffsets::E4
		rest
		note NoteOffsets::E4
		; bar 22
		rest
		note NoteOffsets::E4
		rest
		note NoteOffsets::E4
		; bar 23
		rest
		note NoteOffsets::G4
		rest
		note NoteOffsets::F4
		; bar 24
		rest
		note NoteOffsets::Fs4
		note NoteOffsets::F4
		rest
		next_section

	; POKEY channel 4: 84 notes, 42 rests, 8 sections (5 distinct), 92 bytes
	.export channel_4_music:
	; section 0 - first heard at bars 1-4
	channel_4_section_0:
		; bar 1
		volume 9
		duration 2
		note NoteOffsets::C3
		rest
		note NoteOffsets::F3
		rest
		; bar 2
		note NoteOffsets::G3
		rest
		note NoteOffsets::E3
		rest
		; bar 3
		note NoteOffsets::C3
		note NoteOffsets::C4
		note NoteOffsets::G3
		duration 4
		rest
		; bar 4
		duration 2
		note NoteOffsets::G3
		note NoteOffsets::C3
		rest
		next_section
	; section 1 - first heard at bars 9-12
	channel_4_section_1:
		; bar 9
		duration 2
		note NoteOffsets::C3
		rest
		note NoteOffsets::G3
		rest
		; bar 10
		note NoteOffsets::F3
		rest
		note NoteOffsets::G3
		rest
		; bar 11
		note NoteOffsets::C3
		rest
		note NoteOffsets::G3
		rest
		; bar 12
		note NoteOffsets::F3
		rest
		note NoteOffsets::E3
		rest
		next_section
	; section 2 - first heard at bars 13-16
	channel_4_section_2:
		; bar 13
		duration 2
		note NoteOffsets::C3
		rest
		note NoteOffsets::G3
		rest
		; bar 14
		note NoteOffsets::F3
		rest
		note NoteOffsets::G3
		rest
		; bar 15
		note NoteOffsets::F3
		note NoteOffsets::G3
		note NoteOffsets::A3
		note NoteOffsets::B3
		; bar 16
		rest
		note NoteOffsets::G3
		note NoteOffsets::C3
		rest
		next_section
	; section 3 - first heard at bars 17-20
	channel_4_section_3:
		; bar 17
		duration 2
		note NoteOffsets::C4
		note NoteOffsets::B3
		note NoteOffsets::A3
		note NoteOffsets::G3
		; bar 18
		note NoteOffsets::C4
		note NoteOffsets::B3
		note NoteOffsets::A3
		note NoteOffsets::G3
		; bar 19
		note NoteOffsets::D4
		note NoteOffsets::B3
		note NoteOffsets::A3
		note NoteOffsets::G3
		; bar 20
		note NoteOffsets::D4
		note NoteOffsets::B3
		note NoteOffsets::A3
		note NoteOffsets::G3
		next_section
	; section 4 - first heard at bars 21-24
	channel_4_section_4:
		; bar 21
		duration 2
		note NoteOffsets::C4
		note NoteOffsets::B3
		note NoteOffsets::A3
		note NoteOffsets::G3
		; bar 22
		note NoteOffsets::C4
		note NoteOffsets::B3
		note NoteOffsets::A3
		note NoteOffsets::G3
		; bar 23
		note NoteOffsets::D4
		note NoteOffsets::B3
		note NoteOffsets::A3
		note NoteOffsets::G3
		; bar 24
		rest
		note NoteOffsets::D4
		note NoteOffsets::G3
		rest
		next_section

	; Section lists: the order the sections play in, 4 bars each.
	; A zero entry ends the song - the player rewinds to the first one.

	.export channel_1_sections:
		.word channel_1_section_0	; bars 1-4
		.word channel_1_section_0	; bars 5-8
		.word channel_1_section_1	; bars 9-12
		.word channel_1_section_2	; bars 13-16
		.word channel_1_section_3	; bars 17-20
		.word channel_1_section_4	; bars 21-24
		.word channel_1_section_1	; bars 25-28
		.word channel_1_section_2	; bars 29-32
		.word 0

	.export channel_2_sections:
		.word channel_2_section_0	; bars 1-4
		.word channel_2_section_0	; bars 5-8
		.word channel_2_section_1	; bars 9-12
		.word channel_2_section_2	; bars 13-16
		.word channel_2_section_3	; bars 17-20
		.word channel_2_section_4	; bars 21-24
		.word channel_2_section_1	; bars 25-28
		.word channel_2_section_2	; bars 29-32
		.word 0

	.export channel_3_sections:
		.word channel_3_section_0	; bars 1-4
		.word channel_3_section_0	; bars 5-8
		.word channel_3_section_1	; bars 9-12
		.word channel_3_section_2	; bars 13-16
		.word channel_3_section_3	; bars 17-20
		.word channel_3_section_4	; bars 21-24
		.word channel_3_section_1	; bars 25-28
		.word channel_3_section_2	; bars 29-32
		.word 0

	.export channel_4_sections:
		.word channel_4_section_0	; bars 1-4
		.word channel_4_section_0	; bars 5-8
		.word channel_4_section_1	; bars 9-12
		.word channel_4_section_2	; bars 13-16
		.word channel_4_section_3	; bars 17-20
		.word channel_4_section_4	; bars 21-24
		.word channel_4_section_1	; bars 25-28
		.word channel_4_section_2	; bars 29-32
		.word 0
