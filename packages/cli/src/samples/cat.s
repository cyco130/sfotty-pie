.import "./lib.s"

.global start

.segment "CODE"

start:
	; Copy stdin to stdout
	lda FSTIN
	bmi exit
	lda STDIN
	sta STDOUT
	jmp start

exit:
	lda #0
	sta EXIT
