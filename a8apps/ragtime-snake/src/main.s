; Ragtime Snake - scaffold. Proof of life: cycles the border/background
; color every frame, synced to the vertical blank by watching the OS jiffy
; clock. Replace with an actual game.

.import "./xex.s"
music = .import "./music.s"

output_xex start, $2000

RTCLOK := $14

.code
start:
	jsr music::init


main_loop:

	lda RTCLOK
	wait_vbl:
		cmp RTCLOK
	beq wait_vbl

	jsr music::tick

jmp main_loop
