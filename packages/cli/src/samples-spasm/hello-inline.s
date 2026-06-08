; hello with lib.s inlined into a single module — no `.import`, no `.global`,
; no `.export`. A transitional fixture for step 3 (segments + OUTPUT engine)
; before modules land in step 4. Segment attributes (`type:`/`executable:`) and
; the `.if`/`.error` bounds checks are omitted (deferred).

; --- system labels (only the two this program uses) ---
EXIT := $0200
STDOUT := $0202

; --- segment definitions (attributes deferred) ---
.define_segment "CODE"
.define_segment "RODATA"
.define_segment "DATA"
.define_segment "BSS"
.define_segment "ZEROPAGE"

; --- output format ---
.segment "OUTPUT"
	; Header
	.byte "SFOTTY", 0, 0, 0, 0

	; Vectors
	.word 0          ; NMI (unused)
	.word start      ; reset / entry
	.word 0          ; IRQ (unused)

	; Zero page RAM
	.org $0000
	.emplace "ZEROPAGE"

	; Main RAM
	.org $0400
	.emit "CODE"
	.emit "RODATA"
	.emit "DATA"
	.emplace "BSS"

; --- program (inlined from hello.s) ---
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
	sta EXIT
