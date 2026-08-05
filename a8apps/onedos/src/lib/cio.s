.export ZIOCB  := $20, size: 16

.export ICHIDZ := $20, size: 1 ; Handler ID, set by CIO
.export ICDNOZ := $21, size: 1 ; Device number, set by CIO
.export ICCOMZ := $22, size: 1 ; Command, set by caller
.export ICSTAZ := $23, size: 1 ; Status, set by CIO
.export ICBALZ := $24, size: 1 ; Buffer address low, set by caller
.export ICBAHZ := $25, size: 1 ; Buffer address high, set by caller
.export ICPTLZ := $26, size: 1 ; Put byte routine address minus 1, low byte, set by CIO
.export ICPTHZ := $27, size: 1 ; Put byte routine address minus 1, high byte, set by CIO
.export ICBLLZ := $28, size: 1 ; Buffer length low, set by caller
.export ICBLHZ := $29, size: 1 ; Buffer length high, set by caller
.export ICAX1Z := $2A, size: 1 ; Auxiliary byte 1, open mode, set by caller
.export ICAX2Z := $2B, size: 1 ; Auxiliary byte 2, set by caller
.export ICSPRZ := $2C, size: 2
.export ICIDNO := $2E, size: 1
.export CIOCHR := $2F, size: 1

.export IOCB :=	$0340, size: 16

.export ICHID := $0340, size: 1 ; Handler ID, set by CIO
.export ICDNO := $0341, size: 1 ; Device number, set by CIO
.export ICCOM := $0342, size: 1 ; Command, set by caller
.export ICSTA := $0343, size: 1 ; Status, set by CIO
.export ICBAL := $0344, size: 1 ; Buffer address low, set by caller
.export ICBAH := $0345, size: 1 ; Buffer address high, set by caller
.export ICPTL := $0346, size: 1 ; Put byte routine address minus 1, low byte, set by CIO
.export ICPTH := $0347, size: 1 ; Put byte routine address minus 1, high byte, set by CIO
.export ICBLL := $0348, size: 1 ; Buffer length low, set by caller
.export ICBLH := $0349, size: 1 ; Buffer length high, set by caller
.export ICAX1 := $034A, size: 1 ; Auxiliary byte 1, open mode, set by caller
.export ICAX2 := $034B, size: 1 ; Auxiliary byte 2, set by caller
.export ICAX3 := $034C, size: 1 ; Auxiliary byte 3, sector number low
.export ICAX4 := $034D, size: 1 ; Auxiliary byte 4, sector number high
.export ICAX5 := $034E, size: 1 ; Auxiliary byte 5, sector offset
.export ICAX6 := $034F, size: 1 ; Auxiliary byte 6

.export CIOV := $E456

.export Command = {
	OPEN: $03
	GETREC: $05
	GETCHR: $07
	PUTREC: $09
	PUTCHR: $0B
	CLOSE: $0C
	STATUS: $0D
}

.export OpenMode = {
	READ: $04
	WRITE: $08
	UPDATE: OpenMode::READ | OpenMode::WRITE
}

.macro store channel, dest
	.if .is_immediate_operand(channel)
		sta dest + .operand_value(channel)
	.else
		sta dest,x
	.endif
.endmacro

; Buffer address and buffer length
; - Both set explicitly
; - Address and its length attribute
; - String with the length attribute computed from its length

.export .macro xio                   \
	command,                         \ ; Command code
	channel = .immediate_operand(0), \ ; Channel * 16
	buffer = .null,                  \ ; Buffer address or string
	buffer_len = .null,              \ ; Buffer length (use "unset" to skip)
	aux1 = .null,                    \ ; Auxiliary byte 1
	aux2 = .null,                    \ ; Auxiliary byte 2
	aux3 = .null,                    \ ; Auxiliary byte 3
	aux4 = .null,                    \ ; Auxiliary byte 4
	aux5 = .null,                    \ ; Auxiliary byte 5
	aux6 = .null                     \ ; Auxiliary byte 6
	end = $9B                        \ ; Append to the end of a string, use "" to skip
	rodata = "RODATA"                  ; Segment for string literals

	.if !.is_immediate_operand(channel)
		ldx channel
	.endif

	lda command
	store channel, ICCOM

	.if buffer != .null
		.if .is_string(buffer)
			seg = .segment()
			.segment rodata
				buf_addr: .byte buffer, end
				buf_len = * - buf_addr
			.segment seg

			.if buffer_len = .null
				lda #<buf_addr
				store channel, ICBAL
				lda #>buf_addr
				store channel, ICBAH
			.elseif buffer_len = "unset"
				; Don't set
			.elseif .is_simple_operand(buffer_len)

			.else
				.error "xio: buffer_len must not be specified when buffer is a string"
			.endif
		.elseif .is_simple_operand(buffer)
			lda #<buffer
			store channel, ICBAL
			lda #>buffer
			store channel, ICBAH

			.if buffer_len != .null
				lda #<buffer_len
				store channel, ICBLL
				lda #>buffer_len
				store channel, ICBLH
			.endif
		.else
			.error "xio: buffer must be a string or a simple operand"
		.endif
	.endif

	.if aux1 != .null
		lda #aux1
		store channel, ICAX1
	.endif

	.if aux2 != .null
		lda #aux2
		store channel, ICAX2
	.endif

	.if aux3 != .null
		lda #aux3
		store channel, ICAX3
	.endif

	.if aux4 != .null
		lda #aux4
		store channel, ICAX4
	.endif

	.if aux5 != .null
		lda #aux5
		store channel, ICAX5
	.endif

	.if aux6 != .null
		lda #aux6
		store channel, ICAX6
	.endif

	.if .is_immediate_operand(channel)
		ldx channel
	.endif

	jsr CIOV
.endmacro

.export .macro open channel, aux1, aux2, spec
	xio Command::OPEN, channel: channel, aux1: aux1, aux2: aux2, buffer: spec, buffer_len: "unset"
.endmacro

.export .macro close channel
	xio Command::CLOSE, channel
.endmacro

.export .macro read_line channel, buffer, max_len = .null
	xio Command::GETREC, channel, buffer: buffer, buffer_len: max_len
.endmacro

.export .macro read_bytes channel, buffer, length = .null
	xio Command::GETCHR, channel, buffer: buffer, buffer_len: length
.endmacro

.export .macro put_line channel, buffer, max_len = .immediate_operand($FFFF)
	xio Command::PUTREC, channel, buffer: buffer, buffer_len: max_len
.endmacro

.export .macro put_bytes channel, buffer, length = .null
	xio Command::PUTCHR, channel, buffer: buffer, buffer_len: length
.endmacro
