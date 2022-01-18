.include "lib/vars.s"
.export start

.rodata

message:
	.byte "Hello world!", $0a, 0

.code

start:
	ldx #0
loop:
	lda message,x
	beq end
	sta STDOUT
	inx
	jmp loop
end:
	sta EXIT

