.import "./lib.s"

.global start

.segment "CODE"

start:
	; Copy args to the stdout
	ldx #0
next_arg:
	ldy #0
loop:
	lda ARGS,x
	beq nul
	sta STDOUT
	inx
	iny
	bne loop

nul:
	cpy #0
	beq exit

	lda #' '
	sta STDOUT
	inx
	bne next_arg

exit:
	; Print new line
	lda #$0a
	sta STDOUT

	; Exit with code 0
	lda #0
	sta EXIT
