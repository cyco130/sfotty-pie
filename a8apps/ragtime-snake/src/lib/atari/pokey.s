.export POKEY_AREA := $D200, size: 256 ; POKEY register area

.export POKEY := $D200, size: 4 ; Canonical POKEY register addresses

.export AUDF1 := $D200 ; Audio channel 1 frequency
.export AUDC1 := $D201 ; Audio channel 1 control
.export AUDF2 := $D202 ; Audio channel 2 frequency
.export AUDC2 := $D203 ; Audio channel 2 control
.export AUDF3 := $D204 ; Audio channel 3 frequency
.export AUDC3 := $D205 ; Audio channel 3 control
.export AUDF4 := $D206 ; Audio channel 4 frequency
.export AUDC4 := $D207 ; Audio channel 4 control

.export Audc = {
	VOLUME_MASK: $0F

	VOLUME_ONLY: $10
	NO_NOISE: $20
	POLY_4_BIT: $40 ; Use 4-bit polynomial generator instead of 9/17-bit generator
	NO_BUZZ: $80
}

.export AUDCTL := $D208 ; Audio control

.export Audctl = {
	SLOW_AUDIO_CLOCK: $01 ; Use 15KHz instead of 64KHz clock
	CHANNEL_2_HIGH_PASS: $02
	CHANNEL_1_HIGH_PASS: $04
	LINK_CHANNEL_3_4: $08
	LINK_CHANNEL_1_2: $10
	CHANNEL_3_FAST_CLOCK: $20
	CHANNEL_1_FAST_CLOCK: $40
	POLY_9_BIT: $80 ; Use 9-bit polynomial generator instead of 17-bit generator
}

; Offsets into the 37-note (C3-C6) tables below; sharps and flats are
; enharmonic aliases of the same offset.
.export NoteOffsets = {
	C3: 0
	Cs3: 1
	Db3: 1
	D3: 2
	Ds3: 3
	Eb3: 3
	E3: 4
	F3: 5
	Fs3: 6
	Gb3: 6
	G3: 7
	Gs3: 8
	Ab3: 8
	A3: 9
	As3: 10
	Bb3: 10
	B3: 11

	C4: 12
	Cs4: 13
	Db4: 13
	D4: 14
	Ds4: 15
	Eb4: 15
	E4: 16
	F4: 17
	Fs4: 18
	Gb4: 18
	G4: 19
	Gs4: 20
	Ab4: 20
	A4: 21
	As4: 22
	Bb4: 22
	B4: 23

	C5: 24
	Cs5: 25
	Db5: 25
	D5: 26
	Ds5: 27
	Eb5: 27
	E5: 28
	F5: 29
	Fs5: 30
	Gb5: 30
	G5: 31
	Gs5: 32
	Ab5: 32
	A5: 33
	As5: 34
	Bb5: 34
	B5: 35

	C6: 36
}

; 37 notes (C3-C6), 8 bits with 64K clock
.export .macro emit_8_bit_pal_notes
	.byte 240
	.byte 227
	.byte 214
	.byte 202
	.byte 191
	.byte 180
	.byte 170
	.byte 161
	.byte 152
	.byte 143
	.byte 135
	.byte 128
	.byte 121
	.byte 114
	.byte 107
	.byte 101
	.byte 96
	.byte 90
	.byte 85
	.byte 81
	.byte 76
	.byte 72
	.byte 68
	.byte 64
	.byte 60
	.byte 57
	.byte 54
	.byte 51
	.byte 48
	.byte 45
	.byte 43
	.byte 40
	.byte 38
	.byte 36
	.byte 34
	.byte 32
	.byte 30
.endmacro

; 37 notes (C3-C6), 8 bits with 64K clock
.export .macro emit_8_bit_ntsc_notes
	.byte 242
	.byte 229
	.byte 216
	.byte 204
	.byte 193
	.byte 182
	.byte 172
	.byte 162
	.byte 153
	.byte 145
	.byte 137
	.byte 129
	.byte 122
	.byte 115
	.byte 108
	.byte 102
	.byte 97
	.byte 91
	.byte 86
	.byte 81
	.byte 77
	.byte 72
	.byte 68
	.byte 65
	.byte 61
	.byte 58
	.byte 54
	.byte 51
	.byte 48
	.byte 46
	.byte 43
	.byte 41
	.byte 38
	.byte 36
	.byte 34
	.byte 32
	.byte 31
.endmacro
