; Atari OS equates (just the ones the XEX loader needs).

; Page 2 vectors
.export RUNAD := $02E0		; run address of a loaded binary
.export INITAD := $02E2		; per-segment init address of a loaded binary

; Zero page
.export BOOTQ := $09		; "BOOT?" - successful-boot flags (bit 0 = disk)
.export DOSINI := $0C		; init vector, called on every warmstart
.export SAVMSC := $58		; address of the top-left of the screen

; Page 2 flags
.export COLDST := $0244	; boot in progress; reset would cold-start

; The Device Control Block
.export DDEVIC := $0300
.export DUNIT := $0301
.export DCOMND := $0302
.export DSTATS := $0303
.export DBUFLO := $0304
.export DBUFHI := $0305
.export DBYTLO := $0308
.export DBYTHI := $0309
.export DAUX1 := $030A
.export DAUX2 := $030B

; CIO related
.export ICPTL := $0346
.export HATABS := $031A

; HATABS offsets
.export HATABS_OFFSET_OPEN = 0
.export HATABS_OFFSET_CLOSE = 2
.export HATABS_OFFSET_GET_BYTE = 4
.export HATABS_OFFSET_PUT_BYTE = 6
.export HATABS_OFFSET_STATUS = 8
.export HATABS_OFFSET_SPECIAL = 10

; OS error codes
.export ERR_EOF = 136

; OS vectors
.export SIOV := $E459		; serial I/O entry
.export BLKBDV := $E471	; blackboard (Memo Pad) entry
.export COLDSV := $E477	; cold start entry

; SIO commands
.export SIO_READ = $52
