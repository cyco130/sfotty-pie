.import "./lib.s"

.global start

.segment "RODATA"

message:
	.byte "Hello world!", $0a, 0

.segment "CODE"

start:
	ldx #0
loop:
	lda message,x
	beq end
	sta STDOUT
	inx
	jmp loop
end:
	; A is 0 here, so this will exit with code 0.
	sta EXIT

