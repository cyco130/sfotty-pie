.import "./lib.s"

.global start

.segment "ZEROPAGE"
	low: .res 1
	high: .res 1
	max: .res 1
	tmp: .res 1
	tmp2: .res 1
	tmp3: .res 1
	number: .res 1
	ptr: .res 2

.segment "DATA"
	num_buffer: .byte "00", 0

.segment "BSS"
	input_buffer: .res 128

.segment "RODATA"
	buf_100: .byte "100", 0

.macro mprint str
	.rodata
		message:
		.byte str, 0
	.code
		lda #<message
		ldx #>message
		jsr print
.endmacro

.segment "CODE"
start:
	cld

	; Initialize high and low
	lda #1
	sta low
	lda #100
	sta high

	; Pick a random number between 1 and 100
pick:
	lda RAND
	lsr a
	beq pick
	cmp #101
	bcs pick
	sta number

	; Display the prompt
ask:
	mprint "I'm thinking of a number between "
	lda low
	jsr print_number
	mprint " and "
	lda high
	jsr print_number
	mprint ". Can you guess what it is?\n"

	; Read a line
	ldx #0
read_next:
	lda STDIN
	sta input_buffer,x
	beq read_done
	cmp #$a
	beq read_done
	inx
	bpl read_next
read_done:

	; Skip leading blanks and zeroes
	stx tmp
	ldx #0

skip_leading_zeroes:
	cpx tmp
	beq skipped_leading_zeroes
	lda input_buffer,x
	inx
	cmp #'0'
	beq skip_leading_zeroes
	cmp #' '
	beq skip_leading_zeroes
	cmp #9
	beq skip_leading_zeroes

skipped_leading_zeroes:

	ldy tmp
	lda #0
	sta input_buffer,y

; Parse number
	dex
	cpx tmp
	beq ask
	dec tmp

	lda #0
	sta tmp2

parse_char:
	lda input_buffer,x
	beq parse_done
	sec
	sbc #'0'
	cmp #10
	bcs ask

	; x10 = x2 + x8 = <<1 + <<3
	pha
	lda tmp2
	asl a
	sta tmp3
	asl a
	asl a
	clc
	adc tmp3
	sta tmp2
	pla
	adc tmp2
	sta tmp2

	cmp #101
	bcs ask

	inx
	jmp parse_char

parse_done:
	lda tmp2
	cmp number
	beq found
	bcc too_low

	; Too high
	cmp high
	bcs way_too_high
	sta high
way_too_high:
	mprint "Too high, try again.\n"
	jmp ask

too_low:
	; Too low
	cmp low
	bcc way_too_low
	sta low
way_too_low:
	mprint "Too low, try again.\n"
	jmp ask

found:
	mprint "You got it!\n"

	lda #0
	sta EXIT

; Print subroutine
print:
		sta ptr
		stx ptr+1
		ldy #0
	print_loop:
		lda (ptr),y
		beq print_exit
		sta STDOUT
		iny
		bne print_loop
	print_exit:
		rts

; Print number subroutine
print_number:
	; Special case for 100
		sta tmp
		cmp #100
		bne not_100
		lda #<buf_100
		ldx #>buf_100
		jmp print
	not_100:
		lda tmp
		ldy #$ff
	print_number_loop:
		iny
		sec
		sbc #10
		bcs print_number_loop
		; Add back the extra 10 we subtracted, and the ASCII 0
		adc #10 + '0'
		sta num_buffer+1
		tya
		clc
		adc #'0'
		sta num_buffer
		lda #<num_buffer
		ldx #>num_buffer
		cpy #0
		bne do_print
		clc
		adc #1
		bcc do_print
		inx
	do_print:
		jmp print
