; Long range version of BNE.
; Emits a simple BNE when in range, otherwise a BEQ followed by a JMP to the
; target.
.export .macro jne target
	.if target - * < 130 && * - target < 127
		bne target
	.else
		beq :+
		jmp target
	:
	.endif
.endmacro

; Long range version of BEQ.
; Emits a simple BEQ when in range, otherwise a BNE followed by a JMP to the
; target.
.export .macro jeq target
	.if target - * < 130 && * - target < 127
		beq target
	.else
		bne :+
		jmp target
	:
	.endif
.endmacro

; Long range version of BCC.
; Emits a simple BCC when in range, otherwise a BCS followed by a JMP to the
; target.
.export .macro jcc target
	.if target - * < 130 && * - target < 127
		bcc target
	.else
		bcs :+
		jmp target
	:
	.endif
.endmacro

; Long range version of BCS.
; Emits a simple BCS when in range, otherwise a BCC followed by a JMP to the
; target.
.export .macro jcs target
	.if target - * < 130 && * - target < 127
		bcs target
	.else
		bcc :+
		jmp target
	:
	.endif
.endmacro

; Long range version of BMI.
; Emits a simple BMI when in range, otherwise a BPL followed by a JMP to the
; target.
.export .macro jmi target
	.if target - * < 130 && * - target < 127
		bmi target
	.else
		bpl :+
		jmp target
	:
	.endif
.endmacro

; Long range version of BPL.
; Emits a simple BPL when in range, otherwise a BMI followed by a JMP to the
; target.
.export .macro jpl target
	.if target - * < 130 && * - target < 127
		bpl target
	.else
		bmi :+
		jmp target
	:
	.endif
.endmacro
