; OneDOS - the DOS itself. SCAFFOLD: no real code yet.
;
; Assembles to a binary-load file at $0700, the traditional Atari DOS load
; address. `boot.s` is the three-sector boot loader that brings this in.

.import "./xex.s"

LOAD_ADDRESS = $0700

output_xex start, LOAD_ADDRESS

.code
start:
	rts
