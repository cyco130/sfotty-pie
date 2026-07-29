.export IOCB :=	$0340, size: 16

.export ICHID := $0340, size: 1
.export ICDNO := $0341, size: 1
.export ICCOM := $0342, size: 1
.export ICSTA := $0343, size: 1
.export ICBAL := $0344, size: 1
.export ICBAH := $0345, size: 1
.export ICPTL := $0346, size: 1
.export ICPTH := $0347, size: 1
.export ICBLL := $0348, size: 1
.export ICBLH := $0349, size: 1
.export ICAX1 := $034A, size: 1
.export ICAX2 := $034B, size: 1
.export ICAX3 := $034C, size: 1
.export ICAX4 := $034D, size: 1
.export ICAX5 := $034E, size: 1
.export ICAX6 := $034F, size: 1

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
	.if channel = .immediate_operand(0)
		sta dest
	.else
		sta dest,x
	.endif
.endmacro

.export .macro xio channel, command, buffer = .null, buffer_len = .null, aux1 = .null, aux2 = .null, aux3 = .null, aux4 = .null, aux5 = .null, aux6 = .null
	ldx channel

	lda command
	store channel, ICCOM

	.if buffer != .null
		.if .is_string(buffer)
			seg = .segment()
			.rodata
				buf_addr: .byte buffer, $9B
				buf_len = * - buf_addr
			.segment seg

			.if buffer_len = .null
				lda #<buf_addr
				store channel, ICBAL
				lda #>buf_addr
				store channel, ICBAH
			.else
				.error "xio: buffer_len must not be specified when buffer is a string"
			.endif
		.elseif .is_simple_operand(buffer)
			.if buffer_len = .null
				.error "xio: buffer_len must be specified when buffer is not a string"
			.else
				lda #<buffer
				store channel, ICBAL
				lda #>buffer
				store channel, ICBAH

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
.endmacro
