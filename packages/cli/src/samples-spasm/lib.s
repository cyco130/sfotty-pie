; Global entry point
start := .global::start

; Sfotty CLI system labels
.export EXIT := $0200
.export STDIN := $0201
.export STDOUT := $0202
.export STDERR := $0203
.export RAND := $0240
.export FSTIN := $0241
.export ARGS := $0300

; Segment definitions
.define_segment "CODE", type: "read-only", executable: .true
.define_segment "RODATA", type: "read-only"
.define_segment "DATA", type: "read-write"
.define_segment "BSS", type: "zero-init"
.define_segment "ZEROPAGE", type: "uninitialized"

; Output format
.segment "OUTPUT"
  ; Header
    .byte "SFOTTY", 0, 0, 0, 0

  ; Vectors
    .word 0              ; NMI (unused)
    .word start  ; Reset
    .word 0              ; IRQ (unused)

  ; Zero page RAM
  .org $0000
    .emplace "ZEROPAGE"
  .if * > $0100
    .error "Zero page overflow"
  .endif

  ; Main RAM
  .org $0400
    .emit "CODE"
    .emit "RODATA"
    .emit "DATA"

    .emplace "BSS"

  .if * > $FFFA
    .error "RAM overflow"
  .endif
