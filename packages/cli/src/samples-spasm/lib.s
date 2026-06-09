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

; Segment definitions (attributes — type:/executable: — deferred for now)
.define_segment "CODE"
.define_segment "RODATA"
.define_segment "DATA"
.define_segment "BSS"
.define_segment "ZEROPAGE"

; Output format
.segment "OUTPUT"
  ; Header
    .byte "SFOTTY", 0, 0, 0, 0

  ; Vectors
    .word 0              ; NMI (unused)
    .word start  ; Reset
    .word 0              ; IRQ (unused)

  ; Zero page RAM ( `.if`/`.error` bounds checks deferred — step 2)
  .org $0000
    .emplace "ZEROPAGE"

  ; Main RAM
  .org $0400
    .emit "CODE"
    .emit "RODATA"
    .emit "DATA"

    .emplace "BSS"
