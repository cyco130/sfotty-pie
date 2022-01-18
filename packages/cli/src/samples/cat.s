.include "lib/vars.s"
.export start

.code

start:
	; Copy stdin to stdout
	lda FSTIN
	bmi exit
	lda STDIN
	sta STDOUT
	jmp start

exit:
	sta EXIT
