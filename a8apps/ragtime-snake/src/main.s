; Ragtime Snake - scaffold. Proof of life: plays the song, one player tick
; per frame, and starts it over when it ends. Replace with an actual game.

.import "./xex.s"
player = .import "./music-player.s"
music = .import "./music.s"

output_xex start, $2000

RTCLOK := $14

.code
start:
	jsr start_song

main_loop:

	lda RTCLOK
	wait_vbl:
		cmp RTCLOK
	beq wait_vbl

	jsr player::tick
	bcc main_loop
		jsr start_song

jmp main_loop

; Point the player at the song's four section lists and start from the top.
start_song:
	lda #<music::channel_1_sections
	sta player::sections
	lda #>music::channel_1_sections
	sta player::sections + 1

	lda #<music::channel_2_sections
	sta player::sections + 2
	lda #>music::channel_2_sections
	sta player::sections + 3

	lda #<music::channel_3_sections
	sta player::sections + 4
	lda #>music::channel_3_sections
	sta player::sections + 5

	lda #<music::channel_4_sections
	sta player::sections + 6
	lda #>music::channel_4_sections
	sta player::sections + 7

jmp player::init
