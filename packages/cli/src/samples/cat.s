.import "./lib.s"

output_sfotty_exe start

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
